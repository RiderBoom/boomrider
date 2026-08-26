-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Fix Dispatch, Accept, and Settlement RPCs
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Update dispatch_order with default NULL coordinates and order status check ──
CREATE OR REPLACE FUNCTION dispatch_order(
  p_order_id   TEXT,
  p_pickup_lat FLOAT DEFAULT NULL,
  p_pickup_lng FLOAT DEFAULT NULL,
  p_radius_km  FLOAT DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider      RECORD;
  v_attempt    INT;
  v_offer_id   UUID;
  v_order_data JSONB;
  v_lat        FLOAT := p_pickup_lat;
  v_lng        FLOAT := p_pickup_lng;
BEGIN
  -- Fetch order data
  SELECT data INTO v_order_data FROM orders WHERE id = p_order_id;
  IF v_order_data IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- Verify order status is dispatchable
  IF v_order_data->>'status' NOT IN ('pending', 'preparing', 'ready_to_pickup') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_order_status');
  END IF;

  -- Fallback lat/lng from order pickupLocation or location if not supplied
  IF v_lat IS NULL OR v_lng IS NULL THEN
    v_lat := COALESCE((v_order_data->'pickupLocation'->>'lat')::FLOAT, (v_order_data->'location'->>'lat')::FLOAT);
    v_lng := COALESCE((v_order_data->'pickupLocation'->>'lng')::FLOAT, (v_order_data->'location'->>'lng')::FLOAT);
  END IF;

  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_pickup_coordinates');
  END IF;

  -- Idempotency: skip if a live pending offer already exists for this order
  IF EXISTS (
    SELECT 1 FROM job_offers
    WHERE order_id = p_order_id
      AND status = 'pending'
      AND expires_at > now()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_already_pending');
  END IF;

  -- Skip if order already has an accepted rider
  IF EXISTS (
    SELECT 1 FROM job_offers
    WHERE order_id = p_order_id AND status = 'accepted'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_accepted');
  END IF;

  -- Determine attempt number
  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_attempt
  FROM job_offers WHERE order_id = p_order_id;

  -- Find nearest available rider not yet offered this order
  SELECT
    r.id                      AS rider_id,
    r.data->>'userId'         AS rider_user_id,
    earth_distance(
      ll_to_earth(r.current_lat, r.current_lng),
      ll_to_earth(v_lat, v_lng)
    ) / 1000.0                AS dist_km
  INTO v_rider
  FROM riders r
  WHERE r.is_available = true
    AND r.current_lat  IS NOT NULL
    AND r.current_lng  IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM job_offers jo
      WHERE jo.order_id  = p_order_id
        AND jo.rider_id  = r.id
    )
    AND earth_distance(
          ll_to_earth(r.current_lat, r.current_lng),
          ll_to_earth(v_lat, v_lng)
        ) / 1000.0 <= p_radius_km
  ORDER BY dist_km ASC
  LIMIT 1;

  IF v_rider IS NULL THEN
    UPDATE orders
    SET data = data || '{"dispatchStatus":"no_rider_available"}'::jsonb
    WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'ok',      false,
      'reason',  'no_rider_available',
      'attempt', v_attempt
    );
  END IF;

  INSERT INTO job_offers (order_id, rider_id, rider_user_id, attempt_no)
  VALUES (p_order_id, v_rider.rider_id, v_rider.rider_user_id, v_attempt)
  RETURNING id INTO v_offer_id;

  RETURN jsonb_build_object(
    'ok',       true,
    'offer_id', v_offer_id,
    'rider_id', v_rider.rider_id,
    'attempt',  v_attempt,
    'dist_km',  round(v_rider.dist_km::numeric, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION dispatch_order(TEXT, FLOAT, FLOAT, FLOAT) TO authenticated;

-- ── 2. Guard _wallet_credit against empty/null p_user_id ──
CREATE OR REPLACE FUNCTION _wallet_credit(
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
  v_uid   TEXT;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR p_user_id = 'null' OR p_amount = 0 THEN
    RETURN;
  END IF;

  -- Resolve email to UUID if needed
  IF p_user_id LIKE '%@%' THEN
    SELECT id::TEXT INTO v_uid FROM profiles WHERE email = p_user_id LIMIT 1;
    IF v_uid IS NULL THEN v_uid := p_user_id; END IF;
  ELSE
    v_uid := p_user_id;
  END IF;

  IF v_uid IS NULL OR v_uid = '' OR v_uid = 'null' THEN
    RETURN;
  END IF;

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
  VALUES (v_uid, p_amount, jsonb_build_array(v_entry))
  ON CONFLICT (user_id) DO UPDATE
    SET
      balance = wallets.balance + EXCLUDED.balance,
      history = (jsonb_build_array(v_entry) || COALESCE(wallets.history, '[]'::jsonb));
END;
$$;

-- ── 3. Update process_order_settlement with riderUserId fallback ──
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
  v_rider_id   TEXT;
  v_merch_uid  TEXT;
  v_admin_uid  TEXT;
  v_now_ms     BIGINT;
BEGIN
  -- Resolve admin UUID from profiles
  SELECT id::TEXT INTO v_admin_uid
  FROM profiles WHERE email = 'boomzalnw2@gmail.com' LIMIT 1;

  IF v_admin_uid IS NULL THEN
    v_admin_uid := 'boomzalnw2@gmail.com';
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

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'error', 'concurrent_settlement_in_progress');
END;
$$;

GRANT EXECUTE ON FUNCTION process_order_settlement(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
