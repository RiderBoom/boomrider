-- Add process_order_settlement_internal and process_order_settlement RPC definitions if not already present
CREATE OR REPLACE FUNCTION public._wallet_credit(
  p_user_id TEXT,
  p_amount NUMERIC,
  p_order_id TEXT,
  p_note TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_bangkok  TEXT;
  v_now_epoch_ms BIGINT;
  v_entry        JSONB;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR p_amount = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.wallets (user_id, balance, history)
  VALUES (p_user_id, 0, '[]'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  v_now_bangkok  := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS');
  v_now_epoch_ms := (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT;

  v_entry := jsonb_build_object(
    'id',          gen_random_uuid()::text,
    'type',        CASE WHEN p_amount > 0 THEN 'topup' ELSE 'withdraw' END,
    'amount',      p_amount,
    'date',        v_now_bangkok,
    'desc',        p_note || ' (ออเดอร์ #' || RIGHT(p_order_id, 6) || ')',
    'refOrderId',  p_order_id,
    'createdAtMs', v_now_epoch_ms
  );

  UPDATE public.wallets
  SET balance = balance + p_amount,
      history = jsonb_build_array(v_entry) || COALESCE(history, '[]'::jsonb)
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public._wallet_credit(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

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
  -- Resolve admin UUID from user_roles or profiles
  SELECT user_id::TEXT INTO v_admin_uid
  FROM public.user_roles WHERE role = 'admin' LIMIT 1;

  IF v_admin_uid IS NULL THEN
    SELECT id::TEXT INTO v_admin_uid
    FROM public.profiles WHERE email = 'boomzalnw2@gmail.com' LIMIT 1;
  END IF;

  IF v_admin_uid IS NULL THEN
    v_admin_uid := 'boomzalnw2@gmail.com';
  END IF;

  -- Lock order row without NOWAIT to allow concurrent settlement requests to wait safely
  SELECT data INTO v_order
  FROM orders WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- Early idempotency check if already completed or settled
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

  -- Fallback 1: resolve riderUserId from riders table if missing
  IF (v_rider_uid IS NULL OR v_rider_uid = '') AND v_rider_id IS NOT NULL THEN
    SELECT data->>'userId' INTO v_rider_uid FROM riders WHERE id = v_rider_id;
  END IF;

  -- Fallback 2: look up merchant from restaurants table if not stamped on order
  IF (v_merch_uid IS NULL OR v_merch_uid = '') AND v_type = 'food' THEN
    SELECT data->>'ownerId' INTO v_merch_uid
    FROM restaurants WHERE id = v_order->>'restaurantId';
  END IF;

  -- Income split calculation
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

  -- Wallet credits
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
    ELSE -- parcel
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
        ELSE -- parcel
          PERFORM _wallet_credit(v_rider_uid, -v_gp, p_order_id, 'หัก GP พัสดุ(สด)');
          PERFORM _wallet_credit(v_admin_uid,  v_gp, p_order_id, 'GP พัสดุ(สด)');
        END IF;
      END IF;
    ELSE -- food
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

  -- Early idempotency check before authorization or internal execution
  IF COALESCE(v_order->>'status', '') = 'completed' OR COALESCE(v_order->>'settlementStatus', '') = 'settled' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_settled');
  END IF;

  v_rider_uid := v_order->>'riderUserId';
  v_merch_uid := v_order->>'restaurantOwnerId';

  -- Resolve riderUserId fallback if missing from order JSONB
  IF (v_rider_uid IS NULL OR v_rider_uid = '') AND v_order->>'riderId' IS NOT NULL THEN
    SELECT data->>'userId' INTO v_rider_uid FROM public.riders WHERE id = v_order->>'riderId';
  END IF;

  -- Resolve restaurant owner fallback if missing from order JSONB
  IF (v_merch_uid IS NULL OR v_merch_uid = '') AND COALESCE(v_order->>'type', 'food') = 'food' AND v_order->>'restaurantId' IS NOT NULL THEN
    SELECT data->>'ownerId' INTO v_merch_uid FROM public.restaurants WHERE id = v_order->>'restaurantId';
  END IF;

  -- Verify caller is admin or one of the order participants
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

  -- Prevent non-admin callers from tampering with platform GP rates
  IF NOT public.is_admin(auth.uid()) THEN
    p_gp_food_rate     := 0.30;
    p_gp_delivery_rate := 0.15;
    p_gp_ride_rate     := 0.15;
    p_gp_service_rate  := 0.15;
  END IF;

  RETURN public.process_order_settlement_internal(
    p_order_id, p_gp_food_rate, p_gp_delivery_rate, p_gp_ride_rate, p_gp_service_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_order_settlement(text, numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_order_settlement(text, numeric, numeric, numeric, numeric) TO authenticated;
