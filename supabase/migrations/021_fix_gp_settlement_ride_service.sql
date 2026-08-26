-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Fix GP Settlement for Ride, Service, Parcel, and Food Orders
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Fixes:
-- 1. Adds `p_gp_ride_rate` and `p_gp_service_rate` parameters to `process_order_settlement`.
-- 2. Correctly calculates GP and income splits for `ride` and `service` order types.
-- 3. Fixes cash settlement for `parcel`, `ride`, and `service` orders:
--    Since driver/provider/rider collected 100% cash in hand from the customer,
--    debit GP from their app wallet (-v_gp) and credit admin (+v_gp).
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS process_order_settlement(TEXT);
DROP FUNCTION IF EXISTS process_order_settlement(TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION process_order_settlement(
  p_order_id TEXT,
  p_gp_food_rate NUMERIC DEFAULT 0.30,
  p_gp_delivery_rate NUMERIC DEFAULT 0.15,
  p_gp_ride_rate NUMERIC DEFAULT 0.15,
  p_gp_service_rate NUMERIC DEFAULT 0.15
)
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
  v_total      NUMERIC;
  v_gp         NUMERIC;
  v_merch_inc  NUMERIC;
  v_rider_inc  NUMERIC;
  v_rider_uid  TEXT;
  v_merch_uid  TEXT;
  v_admin_uid  TEXT;
BEGIN
  -- Resolve admin UUID from profiles
  SELECT id::TEXT INTO v_admin_uid
  FROM profiles WHERE email = 'boomzalnw2@gmail.com' LIMIT 1;

  IF v_admin_uid IS NULL THEN
    v_admin_uid := 'boomzalnw2@gmail.com'; -- fallback if profile not found
  END IF;

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
  v_total     := COALESCE((v_order->>'grandTotal')::NUMERIC,  v_deliv);
  v_rider_uid := v_order->>'riderUserId';
  v_merch_uid := v_order->>'restaurantOwnerId';

  -- Fallback: look up merchant from restaurants table if not stamped on order
  IF v_merch_uid IS NULL AND v_type = 'food' THEN
    SELECT data->>'ownerId' INTO v_merch_uid
    FROM restaurants WHERE id = v_order->>'restaurantId';
  END IF;

  -- ── Income split depends on order type ────────────────────────────────────
  IF v_type = 'parcel' THEN
    v_gp        := ROUND(v_deliv * p_gp_delivery_rate, 2);
    v_merch_inc := 0;
    v_rider_inc := ROUND(v_deliv - v_gp, 2);
  ELSIF v_type = 'ride' THEN
    v_gp        := ROUND(v_total * p_gp_ride_rate, 2);
    v_merch_inc := 0;
    v_rider_inc := ROUND(v_total - v_gp, 2);
  ELSIF v_type = 'service' THEN
    v_gp        := ROUND(v_total * p_gp_service_rate, 2);
    v_merch_inc := 0;
    v_rider_inc := ROUND(v_total - v_gp, 2);
  ELSE -- food
    v_gp        := ROUND(v_food * p_gp_food_rate, 2);
    v_merch_inc := ROUND(v_food - v_gp, 2);
    v_rider_inc := v_deliv;
  END IF;

  -- ── Wallet credits ────────────────────────────────────────────────────────
  IF v_method = 'wallet' THEN
    -- Customer already paid via wallet at order placement; distribute to stakeholders
    IF v_type = 'food' THEN
      PERFORM _wallet_credit(v_merch_uid,  v_merch_inc, p_order_id, 'รายได้ร้านค้า');
      PERFORM _wallet_credit(v_rider_uid,  v_rider_inc, p_order_id, 'ค่าส่ง');
      PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP platform');
    ELSIF v_type = 'ride' THEN
      PERFORM _wallet_credit(v_rider_uid,  v_rider_inc, p_order_id, 'ค่าโดยสาร');
      PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP platform');
    ELSIF v_type = 'service' THEN
      PERFORM _wallet_credit(v_rider_uid,  v_rider_inc, p_order_id, 'ค่าบริการ');
      PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP platform');
    ELSE -- parcel
      PERFORM _wallet_credit(v_rider_uid,  v_rider_inc, p_order_id, 'ค่าส่งพัสดุ');
      PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP platform');
    END IF;

  ELSIF v_method = 'cash' THEN
    IF v_type IN ('parcel', 'ride', 'service') THEN
      -- Cash order: rider/driver/provider collected 100% cash in hand from customer.
      -- Net earning = v_total - v_gp. Debit GP from rider's app wallet to pay admin GP.
      IF v_gp > 0 THEN
        IF v_type = 'ride' THEN
          PERFORM _wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP เรียกรถ(สด)');
          PERFORM _wallet_credit(v_admin_uid,  v_gp, p_order_id, 'GP เรียกรถ(สด)');
        ELSIF v_type = 'service' THEN
          PERFORM _wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP บริการ(สด)');
          PERFORM _wallet_credit(v_admin_uid,  v_gp, p_order_id, 'GP บริการ(สด)');
        ELSE -- parcel
          PERFORM _wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP พัสดุ(สด)');
          PERFORM _wallet_credit(v_admin_uid,  v_gp, p_order_id, 'GP พัสดุ(สด)');
        END IF;
      END IF;
    ELSE -- food
      -- Food cash: rider collected (food + delivery) in cash.
      -- Debit food from rider (must remit to merchant/admin), credit merchant income and admin GP.
      PERFORM _wallet_credit(v_rider_uid, -v_food,      p_order_id, 'หักยอดร้าน(สด)');
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
        'grandTotal',     v_total,
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

GRANT EXECUTE ON FUNCTION process_order_settlement(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
