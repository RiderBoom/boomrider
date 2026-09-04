-- ══════════════════════════════════════════════════════════════════════════════
-- 029_rider_cash_wallet_eligibility.sql
-- Enforces atomic rider cash wallet eligibility validation for accepting orders
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Helper function to calculate cash liability for a single order
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
    -- Rider collects foodTotal + deliveryFee in cash, but owes foodTotal (minus GP or to shop/platform) at settlement
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

-- 2. Helper function to compute active cash liabilities for a rider
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

-- 3. Internal function for accept_job_offer with atomic wallet validation
CREATE OR REPLACE FUNCTION public.accept_job_offer_internal(p_offer_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
  v_order RECORD;
  v_rider RECORD;
  v_wallet RECORD;
  v_now_str TEXT;
  v_updated_order JSONB;
  v_wallet_bal NUMERIC := 0;
  v_req_liability NUMERIC := 0;
  v_active_liability NUMERIC := 0;
  v_avail_bal NUMERIC := 0;
BEGIN
  -- 1. Read the offer first without lock
  SELECT * INTO v_offer
  FROM job_offers
  WHERE id = p_offer_id;

  IF v_offer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_found');
  END IF;

  IF v_offer.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_pending');
  END IF;

  IF v_offer.expires_at < now() THEN
     RETURN jsonb_build_object('ok', false, 'reason', 'offer_expired');
  END IF;

  -- 2. Lock parent order to serialize accept attempts globally
  SELECT * INTO v_order FROM orders WHERE id = v_offer.order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- 3. Lock specific offer
  SELECT * INTO v_offer
  FROM job_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF v_offer.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_pending');
  END IF;

  IF EXISTS (
    SELECT 1 FROM job_offers
    WHERE order_id = v_offer.order_id AND status = 'accepted' AND id != p_offer_id
  ) THEN
    UPDATE job_offers
    SET status = 'missed', responded_at = now()
    WHERE id = p_offer_id;

    RETURN jsonb_build_object('ok', false, 'reason', 'already_accepted_by_other');
  END IF;

  -- Fetch rider info
  SELECT * INTO v_rider FROM riders WHERE id = v_offer.rider_id;

  -- Lock rider's wallet row in DB for accurate latest balance
  IF v_offer.rider_user_id IS NOT NULL AND v_offer.rider_user_id != '' THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = v_offer.rider_user_id FOR UPDATE;
    IF v_wallet IS NOT NULL THEN
      v_wallet_bal := COALESCE(v_wallet.balance, 0);
    END IF;
  END IF;

  -- Validate Cash Wallet Reserve if paymentMethod is cash
  v_req_liability := public.calculate_rider_order_cash_liability(v_order.data);
  IF v_req_liability > 0 THEN
    v_active_liability := public.get_rider_active_cash_liability(
      v_offer.rider_id::text,
      v_offer.rider_user_id::text
    );
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
    'riderId', v_offer.rider_id,
    'riderUserId', v_offer.rider_user_id,
    'riderName', COALESCE(v_rider.data->>'name', 'ไรเดอร์'),
    'riderPhone', COALESCE(v_rider.data->>'phone', ''),
    'riderAcceptedAt', v_now_str
  );

  -- Accept offer
  UPDATE job_offers
  SET status = 'accepted', responded_at = now()
  WHERE id = p_offer_id;

  UPDATE job_offers
  SET status = 'missed', responded_at = now()
  WHERE order_id = v_offer.order_id
    AND id != p_offer_id
    AND status = 'pending';

  UPDATE orders
  SET status = 'rider_accepted',
      data = v_updated_order
  WHERE id = v_offer.order_id;

  IF v_offer.rider_id IS NOT NULL THEN
    UPDATE riders SET is_available = false WHERE id = v_offer.rider_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_offer.order_id, 'order_data', v_updated_order);
END;
$$;

-- 4. Internal function for direct manual order acceptance with atomic wallet validation
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
  -- Lock target order
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- Check status is open for acceptance
  IF v_order.status NOT IN ('pending', 'preparing', 'ready_to_pickup') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_already_taken');
  END IF;

  IF (v_order.data->>'riderId') IS NOT NULL AND (v_order.data->>'riderId') <> '' AND (v_order.data->>'riderId') <> p_rider_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_already_taken');
  END IF;

  -- Fetch rider row
  SELECT * INTO v_rider FROM riders WHERE id = p_rider_id;
  IF v_rider IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rider_not_found');
  END IF;

  IF p_rider_user_id IS NULL OR p_rider_user_id = '' THEN
    p_rider_user_id := v_rider.data->>'userId';
  END IF;

  -- Lock rider's wallet row
  IF p_rider_user_id IS NOT NULL AND p_rider_user_id <> '' THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = p_rider_user_id FOR UPDATE;
    IF v_wallet IS NOT NULL THEN
      v_wallet_bal := COALESCE(v_wallet.balance, 0);
    END IF;
  END IF;

  -- Calculate income breakdown
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
  ELSE -- food
    v_gp_amount    := ROUND(v_food_total * v_gp_food_rate, 2);
    v_merch_income := ROUND(v_food_total - v_gp_amount, 2);
    v_rider_income := v_deliv_fee;
  END IF;

  -- Validate Cash Wallet Reserve if paymentMethod is cash
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

  -- Update order row
  UPDATE orders
  SET status = 'rider_accepted',
      data = v_updated_order
  WHERE id = p_order_id;

  -- Mark rider as unavailable
  UPDATE riders SET is_available = false WHERE id = p_rider_id;

  -- Cancel all pending offers for this order
  UPDATE job_offers
  SET status = 'missed', responded_at = now()
  WHERE order_id = p_order_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'order_data', v_updated_order);
END;
$$;

-- 5. Public authorization wrapper for accept_order_direct
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

  SELECT data->>'userId' INTO v_rider_user_id
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

COMMIT;
