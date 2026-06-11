-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Fix process_order_settlement for Parcel Orders
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Problem: Previous version calculated GP from foodTotal only.
--   Parcel orders have foodTotal = 0, so admin GP = 0 and rider kept 100%.
--
-- Fix: Detect order type and use deliveryFee as the GP base for parcels.
--   Parcel: riderIncome = deliveryFee * (1 - gpRate), adminGP = deliveryFee * gpRate
--   Food:   riderIncome = deliveryFee,                adminGP = foodTotal * gpRate
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_order_settlement(p_order_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      JSONB;
  v_type       TEXT;
  v_method     TEXT;
  v_food       NUMERIC;
  v_deliv      NUMERIC;
  v_gp_rate    NUMERIC := 0.10;
  v_gp         NUMERIC;
  v_merch_inc  NUMERIC;
  v_rider_inc  NUMERIC;
  v_rider_uid  TEXT;
  v_merch_uid  TEXT;
  v_admin_uid  TEXT := 'boomzalnw2@gmail.com';
BEGIN
  SELECT data INTO v_order
  FROM orders WHERE id = p_order_id
  FOR UPDATE NOWAIT;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  IF v_order->>'settlementStatus' = 'settled' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_settled');
  END IF;

  v_type      := COALESCE(v_order->>'type', 'food');
  v_method    := v_order->>'paymentMethod';
  v_food      := COALESCE((v_order->>'foodTotal')::NUMERIC,   0);
  v_deliv     := COALESCE((v_order->>'deliveryFee')::NUMERIC, 0);
  v_rider_uid := v_order->>'riderUserId';
  v_merch_uid := v_order->>'restaurantOwnerId';

  -- Fallback: look up merchant from restaurants table if not stamped on order
  IF v_merch_uid IS NULL AND v_type != 'parcel' THEN
    SELECT data->>'ownerId' INTO v_merch_uid
    FROM restaurants WHERE id = v_order->>'restaurantId';
  END IF;

  -- ── Income split depends on order type ────────────────────────────────────
  IF v_type = 'parcel' THEN
    -- Parcel: GP base is the delivery fee (no food total)
    v_gp        := ROUND(v_deliv * v_gp_rate, 2);
    v_merch_inc := 0;
    v_rider_inc := ROUND(v_deliv - v_gp, 2);
  ELSE
    -- Food: GP base is food total; rider earns the full delivery fee
    v_gp        := ROUND(v_food * v_gp_rate, 2);
    v_merch_inc := ROUND(v_food - v_gp, 2);
    v_rider_inc := v_deliv;
  END IF;

  -- ── Wallet credits ────────────────────────────────────────────────────────
  IF v_method = 'wallet' THEN
    -- Customer already paid wallet at placement; distribute to stakeholders
    PERFORM _wallet_credit(v_merch_uid,  v_merch_inc, p_order_id, 'รายได้ร้านค้า');
    PERFORM _wallet_credit(v_rider_uid,  v_rider_inc, p_order_id, 'ค่าส่ง');
    PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP platform');

  ELSIF v_method = 'cash' THEN
    IF v_type = 'parcel' THEN
      -- Parcel cash: rider collected full cash; record net earnings + GP owed to admin
      PERFORM _wallet_credit(v_rider_uid, v_rider_inc, p_order_id, 'ค่าส่งพัสดุ(สด)');
      PERFORM _wallet_credit(v_admin_uid, v_gp,        p_order_id, 'GP พัสดุ(สด)');
    ELSE
      -- Food cash: rider collected (food + delivery); debit food (must remit), credit delivery
      PERFORM _wallet_credit(v_rider_uid, -v_food,      p_order_id, 'หักยอดร้าน(สด)');
      PERFORM _wallet_credit(v_rider_uid,  v_rider_inc, p_order_id, 'ค่าส่ง(สด)');
      PERFORM _wallet_credit(v_merch_uid,  v_merch_inc, p_order_id, 'รายได้ร้านค้า(สด)');
      PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP(สด)');
    END IF;
  END IF;

  UPDATE orders
  SET
    status = 'completed',
    data   = data || jsonb_build_object(
      'status',           'completed',
      'settlementStatus', 'settled',
      'completedAt',      to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
      'settlement', jsonb_build_object(
        'type',           v_type,
        'method',         v_method,
        'foodTotal',      v_food,
        'deliveryFee',    v_deliv,
        'gpAmount',       v_gp,
        'merchantIncome', v_merch_inc,
        'riderIncome',    v_rider_inc
      )
    )
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'type',           v_type,
    'method',         v_method,
    'merchantIncome', v_merch_inc,
    'riderIncome',    v_rider_inc,
    'gpAmount',       v_gp
  );

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'error', 'concurrent_settlement_in_progress');
END;
$$;

GRANT EXECUTE ON FUNCTION process_order_settlement(TEXT) TO authenticated;
