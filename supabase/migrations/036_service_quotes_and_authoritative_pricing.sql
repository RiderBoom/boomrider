-- Migration 035: Server-Authoritative Quote Engine and Quote-Backed Order Placement RPC
-- Description:
--   1. Creates `service_quotes` table to store single-use server quotes expiring in 5 minutes.
--   2. Implements `create_service_quote` SECURITY DEFINER RPC with strict coordinate validation, server-calculated Haversine distance, and server pricing enforcement.
--   3. Updates `place_customer_order` SECURITY DEFINER RPC to enforce quote usage (`quote_id`), single-use lock (`used_at`), atomic wallet checks, and append-only ledger logs.
--   4. Mandates valid quote for all new orders to prevent client price/distance tampering.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Create `service_quotes` Table & Policies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.service_quotes (
  id                      TEXT PRIMARY KEY,
  customer_id             TEXT NOT NULL,
  service_type            TEXT NOT NULL,
  pickup_lat              NUMERIC,
  pickup_lng              NUMERIC,
  dropoff_lat             NUMERIC,
  dropoff_lng             NUMERIC,
  restaurant_id           TEXT,
  address_id              TEXT,
  vehicle_type            TEXT,
  service_category        TEXT,
  distance_meters         NUMERIC NOT NULL DEFAULT 1000,
  billable_km             INT NOT NULL DEFAULT 1,
  distance_source         TEXT NOT NULL DEFAULT 'haversine_estimate',
  pricing_config_version  INT NOT NULL DEFAULT 1,
  base_fee                NUMERIC NOT NULL DEFAULT 20,
  per_km_fee              NUMERIC NOT NULL DEFAULT 10,
  subtotal                NUMERIC NOT NULL DEFAULT 0,
  discount                NUMERIC NOT NULL DEFAULT 0,
  grand_total             NUMERIC NOT NULL DEFAULT 0,
  admin_gp                NUMERIC NOT NULL DEFAULT 0,
  rider_income            NUMERIC NOT NULL DEFAULT 0,
  expires_at              TIMESTAMPTZ NOT NULL,
  used_at                 TIMESTAMPTZ DEFAULT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by quote ID, customer ID, and expiration
CREATE INDEX IF NOT EXISTS idx_service_quotes_cust_exp ON public.service_quotes (customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_service_quotes_used_at ON public.service_quotes (used_at);

-- Enable RLS on `service_quotes`
ALTER TABLE public.service_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_quotes_select_own_or_admin" ON public.service_quotes;
CREATE POLICY "service_quotes_select_own_or_admin" ON public.service_quotes
  FOR SELECT
  USING (
    customer_id = auth.uid()::text OR public.is_admin(auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `create_service_quote` RPC
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_service_quote(
  p_service_type        TEXT,
  p_pickup_lat          NUMERIC DEFAULT NULL,
  p_pickup_lng          NUMERIC DEFAULT NULL,
  p_dropoff_lat         NUMERIC DEFAULT NULL,
  p_dropoff_lng         NUMERIC DEFAULT NULL,
  p_restaurant_id       TEXT DEFAULT NULL,
  p_address_id          TEXT DEFAULT NULL,
  p_service_category    TEXT DEFAULT NULL,
  p_promo_code          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid        TEXT;
  v_quote_id          TEXT;
  v_service_type      TEXT;

  -- Coordinates
  v_plat              NUMERIC := p_pickup_lat;
  v_plng              NUMERIC := p_pickup_lng;
  v_dlat              NUMERIC := p_dropoff_lat;
  v_dlng              NUMERIC := p_dropoff_lng;

  -- Address / Restaurant Lookup Records
  v_rest_data         RECORD;
  v_addr_data         RECORD;

  -- Config Parameters
  v_config_data       JSONB;
  v_base_fee          NUMERIC := 20;
  v_per_km_fee        NUMERIC := 10;
  v_ride_base_fee     NUMERIC := 20;
  v_ride_per_km_fee    NUMERIC := 10;
  v_gp_food_rate      NUMERIC := 0.30;
  v_gp_deliv_rate     NUMERIC := 0.15;
  v_gp_ride_rate      NUMERIC := 0.15;
  v_gp_service_rate   NUMERIC := 0.15;
  v_extra_services    JSONB;

  -- Distance & Pricing Calculations
  v_dist_meters       NUMERIC := 1000;
  v_billable_km       INT := 1;
  v_dist_source       TEXT := 'haversine_estimate';
  v_subtotal          NUMERIC := 0;
  v_discount          NUMERIC := 0;
  v_grand_total       NUMERIC := 0;
  v_admin_gp          NUMERIC := 0;
  v_rider_income      NUMERIC := 0;

  -- Service Category Matching
  v_service_elem      JSONB;
  v_matched_service   BOOLEAN := false;

  -- Promo Code Row
  v_promo_row         RECORD;
  v_promo_data        JSONB;
  v_promo_active      BOOLEAN;
  v_promo_type        TEXT;
  v_promo_val         NUMERIC;
  v_promo_min_order   NUMERIC;
  v_promo_max_disc    NUMERIC;
  v_promo_max_uses    INT;
  v_promo_used_cnt    INT;

  i                   INT;
BEGIN
  -- 1. Authentication Check
  v_caller_uid := auth.uid()::text;
  IF v_caller_uid IS NULL OR v_caller_uid = '' THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate Service Type
  v_service_type := LOWER(COALESCE(p_service_type, 'food'));
  IF v_service_type NOT IN ('food', 'parcel', 'ride', 'service') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_SERVICE_TYPE');
  END IF;

  -- 3. Resolve Coordinates from Canonical DB Records
  IF v_service_type = 'food' THEN
    IF p_restaurant_id IS NOT NULL AND p_restaurant_id <> '' THEN
      SELECT * INTO v_rest_data FROM public.restaurants WHERE id = p_restaurant_id;
      IF v_rest_data.id IS NOT NULL AND v_rest_data.location IS NOT NULL THEN
        v_plat := (v_rest_data.location->>'lat')::NUMERIC;
        v_plng := (v_rest_data.location->>'lng')::NUMERIC;
      END IF;
    END IF;

    IF p_address_id IS NOT NULL AND p_address_id <> '' THEN
      SELECT * INTO v_addr_data FROM public.user_addresses WHERE id = p_address_id AND user_id = v_caller_uid;
      IF v_addr_data.id IS NOT NULL AND v_addr_data.location IS NOT NULL THEN
        v_dlat := (v_addr_data.location->>'lat')::NUMERIC;
        v_dlng := (v_addr_data.location->>'lng')::NUMERIC;
      END IF;
    END IF;
  END IF;

  -- 4. Coordinate Bounds Validation (-90 to 90 lat, -180 to 180 lng)
  IF v_plat IS NULL OR v_plng IS NULL OR v_dlat IS NULL OR v_dlng IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MISSING_COORDINATES');
  END IF;

  IF v_plat < -90 OR v_plat > 90 OR v_dlat < -90 OR v_dlat > 90 OR
     v_plng < -180 OR v_plng > 180 OR v_dlng < -180 OR v_dlng > 180 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_COORDINATES_OUT_OF_BOUNDS');
  END IF;

  -- 5. Calculate Distance Server-Side (Haversine calculation)
  v_dist_meters := public.calculate_haversine_distance(v_plat, v_plng, v_dlat, v_dlng) * 1000.0;
  v_dist_source := 'haversine_estimate';
  v_billable_km := GREATEST(1, CEIL(v_dist_meters / 1000.0)::INT);

  -- 6. Load DB Config
  SELECT data INTO v_config_data FROM public.app_config WHERE id = 1;

  IF v_config_data IS NOT NULL THEN
    v_base_fee        := COALESCE((v_config_data->>'baseFee')::NUMERIC, 20);
    v_per_km_fee      := COALESCE((v_config_data->>'perKmFee')::NUMERIC, 10);
    v_ride_base_fee   := COALESCE((v_config_data->>'rideBaseFee')::NUMERIC, v_base_fee);
    v_ride_per_km_fee  := COALESCE((v_config_data->>'ridePerKmFee')::NUMERIC, v_per_km_fee);

    v_gp_food_rate    := COALESCE((v_config_data->>'gpFood')::NUMERIC, 30) / 100.0;
    v_gp_deliv_rate   := COALESCE((v_config_data->>'gpDelivery')::NUMERIC, 15) / 100.0;
    v_gp_ride_rate    := COALESCE((v_config_data->>'gpRide')::NUMERIC, 15) / 100.0;
    v_gp_service_rate := COALESCE((v_config_data->>'gpService')::NUMERIC, 15) / 100.0;
    v_extra_services  := v_config_data->'extraServices';
  END IF;

  -- 7. Pricing Breakdown by Service Type
  IF v_service_type = 'food' THEN
    v_subtotal := v_base_fee + (v_billable_km * v_per_km_fee);
    v_grand_total := v_subtotal;
    v_admin_gp := ROUND(v_subtotal * v_gp_deliv_rate, 2);
    v_rider_income := v_subtotal;

  ELSIF v_service_type = 'parcel' THEN
    v_subtotal := v_base_fee + (v_billable_km * v_per_km_fee);
    v_grand_total := v_subtotal;
    v_admin_gp := ROUND(v_grand_total * v_gp_deliv_rate, 2);
    v_rider_income := ROUND(v_grand_total - v_admin_gp, 2);

  ELSIF v_service_type = 'ride' THEN
    v_subtotal := v_ride_base_fee + (v_billable_km * v_ride_per_km_fee);
    v_grand_total := v_subtotal;
    v_admin_gp := ROUND(v_grand_total * v_gp_ride_rate, 2);
    v_rider_income := ROUND(v_grand_total - v_admin_gp, 2);

  ELSIF v_service_type = 'service' THEN
    v_subtotal := 350;
    IF v_extra_services IS NOT NULL AND jsonb_array_length(v_extra_services) > 0 THEN
      FOR i IN 0..jsonb_array_length(v_extra_services) - 1 LOOP
        v_service_elem := v_extra_services->i;
        IF (v_service_elem->>'id') = p_service_category OR (v_service_elem->>'name') = p_service_category THEN
          v_subtotal := COALESCE((v_service_elem->>'price')::NUMERIC, 350);
          v_matched_service := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    v_grand_total := v_subtotal;
    v_admin_gp := ROUND(v_grand_total * v_gp_service_rate, 2);
    v_rider_income := ROUND(v_grand_total - v_admin_gp, 2);
  END IF;

  -- 8. Promo Validation
  IF p_promo_code IS NOT NULL AND TRIM(p_promo_code) <> '' THEN
    SELECT * INTO v_promo_row FROM public.promo_codes WHERE UPPER(data->>'code') = UPPER(TRIM(p_promo_code));
    IF v_promo_row.id IS NOT NULL THEN
      v_promo_data      := v_promo_row.data;
      v_promo_active    := COALESCE((v_promo_data->>'active')::BOOLEAN, true);
      v_promo_type      := LOWER(COALESCE(v_promo_data->>'type', 'percent'));
      v_promo_val       := COALESCE((v_promo_data->>'value')::NUMERIC, 0);
      v_promo_min_order  := COALESCE((v_promo_data->>'minOrder')::NUMERIC, 0);
      v_promo_max_disc   := COALESCE((v_promo_data->>'maxDiscount')::NUMERIC, 9999);
      v_promo_max_uses   := COALESCE((v_promo_data->>'maxUses')::INT, 100);
      v_promo_used_cnt   := COALESCE((v_promo_data->>'usedCount')::INT, 0);

      IF v_promo_active AND v_promo_used_cnt < v_promo_max_uses AND v_subtotal >= v_promo_min_order THEN
        IF v_promo_type = 'percent' THEN
          v_discount := LEAST(ROUND(v_subtotal * (v_promo_val / 100.0), 2), v_promo_max_disc);
        ELSE
          v_discount := LEAST(v_promo_val, v_subtotal);
        END IF;
      END IF;
    END IF;
  END IF;

  v_grand_total := GREATEST(0, v_subtotal - v_discount);

  -- 9. Insert Quote
  v_quote_id := 'quote_' || gen_random_uuid()::text;

  INSERT INTO public.service_quotes (
    id, customer_id, service_type,
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
    restaurant_id, address_id, vehicle_type, service_category,
    distance_meters, billable_km, distance_source, pricing_config_version,
    base_fee, per_km_fee, subtotal, discount, grand_total,
    admin_gp, rider_income, expires_at, created_at
  ) VALUES (
    v_quote_id, v_caller_uid, v_service_type,
    v_plat, v_plng, v_dlat, v_dlng,
    p_restaurant_id, p_address_id, NULL, p_service_category,
    v_dist_meters, v_billable_km, v_dist_source, 1,
    v_base_fee, v_per_km_fee, v_subtotal, v_discount, v_grand_total,
    v_admin_gp, v_rider_income, NOW() + INTERVAL '5 minutes', NOW()
  );

  -- 10. Return Response
  RETURN jsonb_build_object(
    'ok', true,
    'quoteId', v_quote_id,
    'customerId', v_caller_uid,
    'serviceType', v_service_type,
    'distanceMeters', v_dist_meters,
    'billableKm', v_billable_km,
    'distanceSource', v_dist_source,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'grandTotal', v_grand_total,
    'adminGP', v_admin_gp,
    'riderIncome', v_rider_income,
    'expiresAt', (NOW() + INTERVAL '5 minutes')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_service_quote(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_service_quote(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Update `place_customer_order` RPC to require & lock `quoteId`
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.place_customer_order(p_order JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid        TEXT;
  v_cust_uid          TEXT;
  v_order_id          TEXT;
  v_existing_order    RECORD;
  v_type              TEXT;
  v_method            TEXT;
  v_status            TEXT;

  -- Quote Verification
  v_quote_id          TEXT;
  v_quote_rec         RECORD;

  -- DB Config & Pricing Parameters
  v_config_data       JSONB;
  v_base_fee          NUMERIC := 20;
  v_per_km_fee        NUMERIC := 10;
  v_gp_food_rate      NUMERIC := 0.30;
  v_gp_deliv_rate     NUMERIC := 0.15;
  v_gp_ride_rate      NUMERIC := 0.15;
  v_gp_service_rate   NUMERIC := 0.15;

  -- Item / Food Calculation Variables
  v_restaurant_id     TEXT;
  v_menu_items_json   JSONB;
  v_req_items         JSONB;
  v_req_item          JSONB;
  v_item_id           TEXT;
  v_orig_id           TEXT;
  v_qty               INT;
  v_db_item           JSONB := NULL;
  v_db_base_price     NUMERIC := 0;
  v_db_opts_extra     NUMERIC := 0;
  v_item_unit_price   NUMERIC := 0;
  v_item_subtotal     NUMERIC := 0;
  v_sel_opts          JSONB;
  v_opt_elem          JSONB;
  v_db_opt            JSONB;
  v_db_opt_price      NUMERIC := 0;
  v_auth_items        JSONB := '[]'::jsonb;

  -- Financial Calculations
  v_calc_food_total   NUMERIC := 0;
  v_calc_deliv_fee    NUMERIC := 0;
  v_promo_discount    NUMERIC := 0;
  v_calc_grand_total  NUMERIC := 0;
  v_admin_gp          NUMERIC := 0;
  v_rider_income      NUMERIC := 0;
  v_distance          NUMERIC := 1;

  -- Wallet Record & History
  v_wallet            RECORD;
  v_bal               NUMERIC := 0;
  v_entry             JSONB;
  v_final_order       JSONB;
  v_now_bangkok       TEXT;
  v_now_epoch_ms      BIGINT;

  i                   INT;
  j                   INT;
  k                   INT;
  v_matched_opt       BOOLEAN;
BEGIN
  -- 1. Authentication Check
  v_caller_uid := auth.uid()::text;
  IF v_caller_uid IS NULL OR v_caller_uid = '' THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- 2. Customer Identity Enforcement
  IF public.is_admin(auth.uid()) THEN
    v_cust_uid := COALESCE(NULLIF(p_order->>'customerId', ''), NULLIF(p_order->>'userId', ''), v_caller_uid);
  ELSE
    v_cust_uid := v_caller_uid;
  END IF;

  -- 3. Order ID & Idempotency Check
  v_order_id := NULLIF(p_order->>'id', '');
  IF v_order_id IS NULL THEN
    v_order_id := gen_random_uuid()::text;
  END IF;

  SELECT * INTO v_existing_order
  FROM public.orders
  WHERE id = v_order_id;

  IF v_existing_order.id IS NOT NULL THEN
    IF v_existing_order.data->>'customerId' = v_cust_uid OR public.is_admin(auth.uid()) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'order', v_existing_order.data,
        'idempotent', true
      );
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'DUPLICATE_ORDER');
    END IF;
  END IF;

  -- 4. Payment Method & Type Validation
  v_method := LOWER(COALESCE(p_order->>'paymentMethod', 'cash'));
  IF v_method NOT IN ('cash', 'wallet', 'online') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_PAYMENT_METHOD');
  END IF;

  v_type := LOWER(COALESCE(p_order->>'type', 'food'));
  IF v_type NOT IN ('food', 'parcel', 'ride', 'service') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_ORDER_TYPE');
  END IF;

  IF v_type = 'food' THEN
    v_status := 'pending';
  ELSE
    v_status := 'ready_to_pickup';
  END IF;

  -- 5. Quote Verification (Mandatory Server-Authoritative Quote)
  v_quote_id := p_order->>'quoteId';
  IF v_quote_id IS NULL OR v_quote_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_REQUIRED');
  END IF;

  SELECT * INTO v_quote_rec
  FROM public.service_quotes
  WHERE id = v_quote_id
  FOR UPDATE;

  IF v_quote_rec.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_NOT_FOUND');
  END IF;

  IF v_quote_rec.customer_id <> v_cust_uid AND NOT public.is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_ACCESS_DENIED');
  END IF;

  IF v_quote_rec.service_type <> v_type THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_SERVICE_MISMATCH');
  END IF;

  IF v_quote_rec.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_ALREADY_USED');
  END IF;

  IF v_quote_rec.expires_at < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTE_EXPIRED');
  END IF;

  -- Extract delivery fee, promo discount, grand total, admin GP, rider income from quote
  v_calc_deliv_fee := v_quote_rec.subtotal;
  v_promo_discount := v_quote_rec.discount;
  v_distance       := v_quote_rec.billable_km;
  v_admin_gp       := v_quote_rec.admin_gp;
  v_rider_income   := v_quote_rec.rider_income;

  -- Mark quote used
  UPDATE public.service_quotes
  SET used_at = NOW()
  WHERE id = v_quote_id;

  -- 6. Load DB Config for Base Rates
  SELECT data INTO v_config_data FROM public.app_config WHERE id = 1;

  IF v_config_data IS NOT NULL THEN
    v_base_fee     := COALESCE((v_config_data->>'baseFee')::NUMERIC, 20);
    v_per_km_fee   := COALESCE((v_config_data->>'perKmFee')::NUMERIC, 10);
    v_gp_food_rate := COALESCE((v_config_data->>'gpFood')::NUMERIC, 30) / 100.0;
  END IF;

  -- 7. Calculate Food Subtotal strictly from DB menu items
  IF v_type = 'food' THEN
    v_restaurant_id := p_order->>'restaurantId';
    IF v_restaurant_id IS NULL OR v_restaurant_id = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'MISSING_RESTAURANT_ID');
    END IF;

    SELECT items INTO v_menu_items_json
    FROM public.menu_items
    WHERE restaurant_id = v_restaurant_id;

    IF v_menu_items_json IS NULL OR jsonb_array_length(v_menu_items_json) = 0 THEN
      SELECT data->'menu' INTO v_menu_items_json
      FROM public.restaurants
      WHERE id = v_restaurant_id;
    END IF;

    v_req_items := p_order->'items';
    IF v_req_items IS NULL OR jsonb_array_length(v_req_items) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'EMPTY_FOOD_ORDER');
    END IF;

    FOR i IN 0..jsonb_array_length(v_req_items) - 1 LOOP
      v_req_item := v_req_items->i;
      v_item_id  := v_req_item->>'id';
      v_orig_id  := COALESCE(v_req_item->>'originalId', v_item_id);
      v_qty      := COALESCE((v_req_item->>'qty')::INT, 0);

      IF v_qty <= 0 OR v_qty > 100 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_QUANTITY');
      END IF;

      v_db_item := NULL;
      IF v_menu_items_json IS NOT NULL AND jsonb_array_length(v_menu_items_json) > 0 THEN
        FOR j IN 0..jsonb_array_length(v_menu_items_json) - 1 LOOP
          IF (v_menu_items_json->j->>'id') = v_orig_id OR (v_menu_items_json->j->>'id') = v_item_id THEN
            v_db_item := v_menu_items_json->j;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_db_item IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_ITEM', 'itemId', v_orig_id);
      END IF;

      IF COALESCE((v_db_item->>'available')::BOOLEAN, true) = false THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'ITEM_UNAVAILABLE', 'itemName', v_db_item->>'name');
      END IF;

      v_db_base_price := COALESCE((v_db_item->>'price')::NUMERIC, 0);
      v_db_opts_extra := 0;
      v_sel_opts := v_req_item->'selectedOptions';

      IF v_sel_opts IS NOT NULL AND jsonb_array_length(v_sel_opts) > 0 THEN
        FOR k IN 0..jsonb_array_length(v_sel_opts) - 1 LOOP
          v_opt_elem := v_sel_opts->k;
          v_matched_opt := false;

          IF v_db_item->'options' IS NOT NULL AND jsonb_array_length(v_db_item->'options') > 0 THEN
            FOR j IN 0..jsonb_array_length(v_db_item->'options') - 1 LOOP
              v_db_opt := v_db_item->'options'->j;
              IF (v_db_opt->>'name') = (v_opt_elem->>'name') THEN
                v_db_opt_price := COALESCE((v_db_opt->>'price')::NUMERIC, 0);
                v_db_opts_extra := v_db_opts_extra + v_db_opt_price;
                v_matched_opt := true;
                EXIT;
              END IF;
            END LOOP;
          END IF;

          IF NOT v_matched_opt THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_OPTION', 'optionName', v_opt_elem->>'name');
          END IF;
        END LOOP;
      END IF;

      v_item_unit_price := ROUND(v_db_base_price + v_db_opts_extra, 2);
      v_item_subtotal   := ROUND(v_item_unit_price * v_qty, 2);
      v_calc_food_total := v_calc_food_total + v_item_subtotal;

      v_auth_items := v_auth_items || jsonb_build_object(
        'id', v_item_id,
        'originalId', v_orig_id,
        'name', COALESCE(v_db_item->>'name', v_req_item->>'name'),
        'price', v_item_unit_price,
        'qty', v_qty,
        'selectedOptions', COALESCE(v_sel_opts, '[]'::jsonb)
      );
    END LOOP;

    v_calc_grand_total := GREATEST(0, v_calc_food_total + v_calc_deliv_fee - v_promo_discount);

  ELSE
    v_calc_food_total := 0;
    v_calc_grand_total := GREATEST(0, v_calc_deliv_fee - v_promo_discount);
  END IF;

  -- 8. Wallet Deduction (Atomic Row Lock)
  IF v_method = 'wallet' AND v_calc_grand_total > 0 THEN
    INSERT INTO public.wallets (user_id, balance, history)
    VALUES (v_cust_uid, 0, '[]'::jsonb)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE user_id = v_cust_uid
    FOR UPDATE;

    v_bal := COALESCE(v_wallet.balance, 0);

    IF v_bal < v_calc_grand_total THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_CUSTOMER_WALLET',
        'requiredBalance', v_calc_grand_total,
        'currentBalance', v_bal
      );
    END IF;

    v_now_bangkok  := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS');
    v_now_epoch_ms := (extract(epoch FROM now()) * 1000)::BIGINT;

    v_entry := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'withdraw',
      'amount', -v_calc_grand_total,
      'date', v_now_bangkok,
      'desc', 'ชำระค่าสินค้า/บริการ ออเดอร์ #' || right(v_order_id, 6),
      'refOrderId', v_order_id,
      'createdAtMs', v_now_epoch_ms,
      'actorUserId', v_caller_uid
    );

    UPDATE public.wallets
    SET balance = balance - v_calc_grand_total,
        history = jsonb_build_array(v_entry) || COALESCE(history, '[]'::jsonb)
    WHERE user_id = v_cust_uid;
  END IF;

  -- 9. Construct Final Authoritative Payload
  v_final_order := p_order || jsonb_build_object(
    'id', v_order_id,
    'quoteId', v_quote_id,
    'type', v_type,
    'status', v_status,
    'customerId', v_cust_uid,
    'paymentMethod', v_method,
    'distance', v_distance,
    'foodTotal', v_calc_food_total,
    'deliveryFee', v_calc_deliv_fee,
    'promoDiscount', v_promo_discount,
    'grandTotal', v_calc_grand_total,
    'adminGP', v_admin_gp,
    'riderIncome', v_rider_income,
    'createdAt', COALESCE(p_order->>'createdAt', to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'))
  );

  IF v_type = 'food' THEN
    v_final_order := v_final_order || jsonb_build_object('items', v_auth_items);
  END IF;

  -- 10. Persist Order
  INSERT INTO public.orders (id, status, data)
  VALUES (v_order_id, v_status, v_final_order);

  -- 11. Return Authoritative Pricing Result
  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'quoteId', v_quote_id,
    'order', v_final_order,
    'pricing', jsonb_build_object(
      'foodTotal', v_calc_food_total,
      'deliveryFee', v_calc_deliv_fee,
      'promoDiscount', v_promo_discount,
      'grandTotal', v_calc_grand_total
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_customer_order(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_customer_order(JSONB) TO authenticated;
