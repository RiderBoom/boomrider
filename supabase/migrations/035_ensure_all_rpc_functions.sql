-- ══════════════════════════════════════════════════════════════════════════════
-- 035_ensure_all_rpc_functions.sql
-- Consolidates and enforces presence of create_admin_notification, accept_order_direct,
-- and process_order_settlement RPC functions with accurate signatures and permissions.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Create Admin Notification RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_admin_notification(
  p_title text,
  p_message text,
  p_type text DEFAULT 'info'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.admin_notifs (id, title, message, type, at)
  VALUES (
    v_id,
    left(COALESCE(p_title, ''), 160),
    left(COALESCE(p_message, ''), 1000),
    CASE WHEN p_type IN ('info', 'success', 'warning', 'error') THEN p_type ELSE 'info' END,
    to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS')
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_notification(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_admin_notification(text, text, text) TO authenticated;

-- ── 2. Private Wallet Credit Helper for Settlement RPCs ───────────────────────
CREATE OR REPLACE FUNCTION public._wallet_credit(
  p_user_id  TEXT,
  p_amount   NUMERIC,
  p_order_id TEXT,
  p_note     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry JSONB;
BEGIN
  IF p_user_id IS NULL OR p_amount = 0 THEN RETURN; END IF;

  v_entry := jsonb_build_object(
    'id',          gen_random_uuid()::text,
    'type',        CASE WHEN p_amount >= 0 THEN 'deposit' ELSE 'withdraw' END,
    'amount',      p_amount,
    'date',        to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
    'desc',        p_note,
    'refOrderId',  p_order_id,
    'createdAtMs', (extract(epoch from now()) * 1000)::bigint
  );

  INSERT INTO wallets (user_id, balance, history)
  VALUES (p_user_id, p_amount, jsonb_build_array(v_entry))
  ON CONFLICT (user_id) DO UPDATE
    SET
      balance = wallets.balance + EXCLUDED.balance,
      history = (jsonb_build_array(v_entry) || COALESCE(wallets.history, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public._wallet_credit(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 3. Rider Cash Liability Helpers ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_rider_order_cash_liability(
  v_order JSONB,
  p_gp_food_rate NUMERIC DEFAULT 0.30,
  p_gp_delivery_rate NUMERIC DEFAULT 0.15,
  p_gp_ride_rate NUMERIC DEFAULT 0.15,
  p_gp_service_rate NUMERIC DEFAULT 0.15
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type      TEXT;
  v_method    TEXT;
  v_food      NUMERIC;
  v_deliv     NUMERIC;
  v_total     NUMERIC;
  v_gp        NUMERIC;
BEGIN
  v_method := COALESCE(v_order->>'paymentMethod', 'cash');
  IF v_method IS DISTINCT FROM 'cash' THEN
    RETURN 0;
  END IF;

  v_type  := COALESCE(v_order->>'type', 'food');
  v_food  := COALESCE((v_order->>'foodTotal')::NUMERIC, 0);
  v_deliv := COALESCE((v_order->>'deliveryFee')::NUMERIC, 0);
  v_total := COALESCE((v_order->>'grandTotal')::NUMERIC, v_deliv);

  IF v_type = 'food' THEN
    RETURN v_food;
  ELSIF v_type = 'parcel' THEN
    v_gp := COALESCE((v_order->>'adminGP')::NUMERIC, ROUND(v_deliv * p_gp_delivery_rate, 2));
    RETURN v_gp;
  ELSIF v_type = 'ride' THEN
    v_gp := COALESCE((v_order->>'adminGP')::NUMERIC, ROUND(v_total * p_gp_ride_rate, 2));
    RETURN v_gp;
  ELSIF v_type = 'service' THEN
    v_gp := COALESCE((v_order->>'adminGP')::NUMERIC, ROUND(v_total * p_gp_service_rate, 2));
    RETURN v_gp;
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_rider_active_cash_liability(
  p_rider_id TEXT,
  p_rider_user_id TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_liability NUMERIC := 0;
  v_rec RECORD;
BEGIN
  IF (p_rider_id IS NULL OR p_rider_id = '') AND (p_rider_user_id IS NULL OR p_rider_user_id = '') THEN
    RETURN 0;
  END IF;

  FOR v_rec IN
    SELECT data
    FROM public.orders
    WHERE (
            (p_rider_id IS NOT NULL AND p_rider_id <> '' AND data->>'riderId' = p_rider_id)
            OR
            (p_rider_user_id IS NOT NULL AND p_rider_user_id <> '' AND data->>'riderUserId' = p_rider_user_id)
          )
      AND status IN ('rider_accepted', 'picking_up', 'delivering')
      AND COALESCE(data->>'paymentMethod', 'cash') = 'cash'
      AND COALESCE(data->>'settlementStatus', '') <> 'settled'
  LOOP
    v_total_liability := v_total_liability + public.calculate_rider_order_cash_liability(v_rec.data);
  END LOOP;

  RETURN v_total_liability;
END;
$$;

-- ── 4. Direct Manual Order Acceptance RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_order_direct_internal(
  p_order_id TEXT,
  p_rider_id TEXT,
  p_rider_user_id TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_rider RECORD;
  v_wallet RECORD;
  v_now_str TEXT;
  v_updated_order JSONB;
  v_wallet_bal NUMERIC := 0;
  v_req_liability NUMERIC := 0;
  v_active_liability NUMERIC := 0;
  v_avail_bal NUMERIC := 0;
  v_food_total NUMERIC := 0;
  v_deliv_fee NUMERIC := 0;
  v_grand_total NUMERIC := 0;
  v_type TEXT := 'food';
  v_gp_amount NUMERIC := 0;
  v_merch_income NUMERIC := 0;
  v_rider_income NUMERIC := 0;
  v_gp_food_rate NUMERIC := 0.30;
  v_gp_deliv_rate NUMERIC := 0.15;
  v_gp_ride_rate NUMERIC := 0.15;
  v_gp_service_rate NUMERIC := 0.15;
BEGIN
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.status NOT IN ('pending', 'preparing', 'ready_to_pickup') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_already_taken');
  END IF;

  IF (v_order.data->>'riderId') IS NOT NULL AND (v_order.data->>'riderId') <> '' AND (v_order.data->>'riderId') <> p_rider_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_already_taken');
  END IF;

  SELECT * INTO v_rider FROM riders WHERE id = p_rider_id;
  IF v_rider IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rider_not_found');
  END IF;

  IF p_rider_user_id IS NULL OR p_rider_user_id = '' THEN
    p_rider_user_id := COALESCE(v_rider.user_id, v_rider.data->>'userId');
  END IF;

  IF p_rider_user_id IS NOT NULL AND p_rider_user_id <> '' THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = p_rider_user_id FOR UPDATE;
    IF v_wallet IS NOT NULL THEN
      v_wallet_bal := COALESCE(v_wallet.balance, 0);
    END IF;
  END IF;

  v_type        := COALESCE(v_order.data->>'type', 'food');
  v_food_total  := COALESCE((v_order.data->>'foodTotal')::NUMERIC, 0);
  v_deliv_fee   := COALESCE((v_order.data->>'deliveryFee')::NUMERIC, 0);
  v_grand_total := COALESCE((v_order.data->>'grandTotal')::NUMERIC, v_deliv_fee);

  IF v_type = 'parcel' THEN
    v_gp_amount    := ROUND(v_deliv_fee * v_gp_deliv_rate, 2);
    v_merch_income := 0;
    v_rider_income := ROUND(v_deliv_fee - v_gp_amount, 2);
  ELSIF v_type = 'ride' THEN
    v_gp_amount    := ROUND(v_grand_total * v_gp_ride_rate, 2);
    v_merch_income := 0;
    v_rider_income := ROUND(v_grand_total - v_gp_amount, 2);
  ELSIF v_type = 'service' THEN
    v_gp_amount    := ROUND(v_grand_total * v_gp_service_rate, 2);
    v_merch_income := 0;
    v_rider_income := ROUND(v_grand_total - v_gp_amount, 2);
  ELSE
    v_gp_amount    := ROUND(v_food_total * v_gp_food_rate, 2);
    v_merch_income := ROUND(v_food_total - v_gp_amount, 2);
    v_rider_income := v_deliv_fee;
  END IF;

  v_req_liability := public.calculate_rider_order_cash_liability(v_order.data);
  IF v_req_liability > 0 THEN
    v_active_liability := public.get_rider_active_cash_liability(p_rider_id, p_rider_user_id);
    v_avail_bal := v_wallet_bal - v_active_liability;

    IF v_avail_bal < v_req_liability THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_RIDER_WALLET',
        'requiredBalance', v_req_liability,
        'currentBalance', v_wallet_bal,
        'availableBalance', ROUND(v_avail_bal, 2)
      );
    END IF;
  END IF;

  v_now_str := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS');

  v_updated_order := v_order.data || jsonb_build_object(
    'status', 'rider_accepted',
    'riderId', p_rider_id,
    'riderUserId', p_rider_user_id,
    'riderName', COALESCE(v_rider.data->>'name', 'ไรเดอร์'),
    'riderPhone', COALESCE(v_rider.data->>'phone', ''),
    'riderAcceptedAt', v_now_str,
    'riderIncome', v_rider_income,
    'merchantIncome', v_merch_income,
    'adminGP', v_gp_amount
  );

  UPDATE orders
  SET status = 'rider_accepted',
      data = v_updated_order
  WHERE id = p_order_id;

  UPDATE riders SET is_available = false WHERE id = p_rider_id;

  IF to_regclass('public.job_offers') IS NOT NULL THEN
    UPDATE job_offers
    SET status = 'missed', responded_at = now()
    WHERE order_id = p_order_id AND status = 'pending';
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'order_data', v_updated_order);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_order_direct_internal(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_order_direct(
  p_order_id TEXT,
  p_rider_id TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider_user_id TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(user_id, data->>'userId') INTO v_rider_user_id
  FROM riders
  WHERE id = p_rider_id;

  IF v_rider_user_id IS NULL OR (v_rider_user_id <> auth.uid()::text AND NOT public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'rider_access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN public.accept_order_direct_internal(p_order_id, p_rider_id, v_rider_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_order_direct(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_order_direct(TEXT, TEXT) TO authenticated;

-- ── 5. Order Settlement Procedure & RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_order_settlement_internal(
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
  v_rider_id   TEXT;
  v_merch_uid  TEXT;
  v_admin_uid  TEXT;
  v_now_ms     BIGINT;
BEGIN
  SELECT user_id::TEXT INTO v_admin_uid
  FROM user_roles WHERE role = 'admin' LIMIT 1;

  IF v_admin_uid IS NULL THEN
    SELECT id::TEXT INTO v_admin_uid
    FROM profiles WHERE email = 'boomzalnw2@gmail.com' LIMIT 1;
  END IF;

  IF v_admin_uid IS NULL THEN
    v_admin_uid := 'boomzalnw2@gmail.com';
  END IF;

  SELECT data INTO v_order
  FROM orders WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  IF COALESCE(v_order->>'status', '') = 'completed' OR COALESCE(v_order->>'settlementStatus', '') = 'settled' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_settled');
  END IF;

  v_type      := COALESCE(v_order->>'type', 'food');
  v_method    := v_order->>'paymentMethod';
  v_food      := COALESCE((v_order->>'foodTotal')::NUMERIC,   0);
  v_deliv     := COALESCE((v_order->>'deliveryFee')::NUMERIC, 0);
  v_total     := COALESCE((v_order->>'grandTotal')::NUMERIC,  v_deliv);
  v_rider_uid := v_order->>'riderUserId';
  v_rider_id  := v_order->>'riderId';
  v_merch_uid := v_order->>'restaurantOwnerId';

  IF (v_rider_uid IS NULL OR v_rider_uid = '') AND v_rider_id IS NOT NULL THEN
    SELECT COALESCE(user_id, data->>'userId') INTO v_rider_uid FROM riders WHERE id = v_rider_id;
  END IF;

  IF (v_merch_uid IS NULL OR v_merch_uid = '') AND v_type = 'food' THEN
    SELECT COALESCE(owner_id, data->>'ownerId') INTO v_merch_uid
    FROM restaurants WHERE id = v_order->>'restaurantId';
  END IF;

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
  ELSE
    v_gp        := ROUND(v_food * p_gp_food_rate, 2);
    v_merch_inc := ROUND(v_food - v_gp, 2);
    v_rider_inc := v_deliv;
  END IF;

  IF v_method = 'wallet' THEN
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
    ELSE
      PERFORM _wallet_credit(v_rider_uid,  v_rider_inc, p_order_id, 'ค่าส่งพัสดุ');
      PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP platform');
    END IF;

  ELSIF v_method = 'cash' THEN
    IF v_type IN ('parcel', 'ride', 'service') THEN
      IF v_gp > 0 THEN
        IF v_type = 'ride' THEN
          PERFORM _wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP เรียกรถ(สด)');
          PERFORM _wallet_credit(v_admin_uid,  v_gp, p_order_id, 'GP เรียกรถ(สด)');
        ELSIF v_type = 'service' THEN
          PERFORM _wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP บริการ(สด)');
          PERFORM _wallet_credit(v_admin_uid,  v_gp, p_order_id, 'GP บริการ(สด)');
        ELSE
          PERFORM _wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP พัสดุ(สด)');
          PERFORM _wallet_credit(v_admin_uid,  v_gp, p_order_id, 'GP พัสดุ(สด)');
        END IF;
      END IF;
    ELSE
      PERFORM _wallet_credit(v_rider_uid, -v_food,      p_order_id, 'หักยอดร้าน(สด)');
      PERFORM _wallet_credit(v_merch_uid,  v_merch_inc, p_order_id, 'รายได้ร้านค้า(สด)');
      PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP(สด)');
    END IF;
  END IF;

  v_now_ms := (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT;

  UPDATE orders
  SET
    status = 'completed',
    data   = data || jsonb_build_object(
      'status',           'completed',
      'settlementStatus', 'settled',
      'completedAt',      to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
      'completedAtMs',    v_now_ms,
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
    'gpAmount',       v_gp,
    'completedAtMs',  v_now_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_order_settlement_internal(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_order_settlement(
  p_order_id text,
  p_gp_food_rate numeric DEFAULT 0.30,
  p_gp_delivery_rate numeric DEFAULT 0.15,
  p_gp_ride_rate numeric DEFAULT 0.15,
  p_gp_service_rate numeric DEFAULT 0.15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order     jsonb;
  v_rider_uid text;
  v_merch_uid text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT data INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'order_not_found'); END IF;

  IF COALESCE(v_order->>'status', '') = 'completed' OR COALESCE(v_order->>'settlementStatus', '') = 'settled' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_settled');
  END IF;

  v_rider_uid := v_order->>'riderUserId';
  v_merch_uid := v_order->>'restaurantOwnerId';

  IF (v_rider_uid IS NULL OR v_rider_uid = '') AND v_order->>'riderId' IS NOT NULL THEN
    SELECT COALESCE(user_id, data->>'userId') INTO v_rider_uid FROM public.riders WHERE id = v_order->>'riderId';
  END IF;

  IF (v_merch_uid IS NULL OR v_merch_uid = '') AND COALESCE(v_order->>'type', 'food') = 'food' AND v_order->>'restaurantId' IS NOT NULL THEN
    SELECT COALESCE(owner_id, data->>'ownerId') INTO v_merch_uid FROM public.restaurants WHERE id = v_order->>'restaurantId';
  END IF;

  IF NOT public.is_admin(auth.uid())
     AND auth.uid()::text NOT IN (
       COALESCE(v_order->>'customerId', ''),
       COALESCE(v_order->>'userId', ''),
       COALESCE(v_merch_uid, ''),
       COALESCE(v_rider_uid, '')
     )
  THEN
    RAISE EXCEPTION 'settlement_access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN public.process_order_settlement_internal(
    p_order_id, p_gp_food_rate, p_gp_delivery_rate, p_gp_ride_rate, p_gp_service_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_order_settlement(text, numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_order_settlement(text, numeric, numeric, numeric, numeric) TO authenticated;

COMMIT;
