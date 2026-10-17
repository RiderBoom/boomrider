-- Road-distance quotes are produced by the authenticated Edge Function.
-- The public OSRM endpoint is free to use; if it is unavailable, no quote is issued.

CREATE OR REPLACE FUNCTION public.create_service_quote_from_route(
  p_customer_id TEXT,
  p_service_type TEXT,
  p_pickup_lat NUMERIC,
  p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC,
  p_dropoff_lng NUMERIC,
  p_route_distance_meters NUMERIC,
  p_restaurant_id TEXT DEFAULT NULL,
  p_address_id TEXT DEFAULT NULL,
  p_service_category TEXT DEFAULT NULL,
  p_promo_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote JSONB;
  v_quote_id TEXT;
  v_type TEXT := LOWER(COALESCE(p_service_type, ''));
  v_billable_km INT;
  v_base_fee NUMERIC;
  v_per_km_fee NUMERIC;
  v_discount NUMERIC;
  v_subtotal NUMERIC;
  v_grand_total NUMERIC;
  v_admin_gp NUMERIC;
  v_rider_income NUMERIC;
  v_gp_rate NUMERIC;
  v_config JSONB;
BEGIN
  IF p_customer_id IS NULL OR p_customer_id = '' OR v_type NOT IN ('food', 'parcel', 'ride', 'service') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_REQUEST');
  END IF;

  IF v_type <> 'service' AND (p_route_distance_meters IS NULL OR p_route_distance_meters <= 0 OR p_route_distance_meters > 2000000) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_ROUTE_DISTANCE');
  END IF;

  -- The existing routine keeps all coordinate, restaurant/address and promotion checks in one place.
  PERFORM set_config('request.jwt.claim.sub', p_customer_id, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_customer_id)::text, true);
  v_quote := public.create_service_quote(
    v_type, p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
    p_restaurant_id, p_address_id, p_service_category, p_promo_code
  );
  IF NOT COALESCE((v_quote->>'ok')::BOOLEAN, false) THEN RETURN v_quote; END IF;

  v_quote_id := v_quote->>'quoteId';
  IF v_type = 'service' THEN RETURN v_quote; END IF;

  v_billable_km := GREATEST(1, CEIL(p_route_distance_meters / 1000.0)::INT);
  SELECT data INTO v_config FROM public.app_config WHERE id = 1;
  v_base_fee := CASE WHEN v_type = 'ride'
    THEN COALESCE((v_config->>'rideBaseFee')::NUMERIC, (v_config->>'baseFee')::NUMERIC, 20)
    ELSE COALESCE((v_config->>'baseFee')::NUMERIC, 20) END;
  v_per_km_fee := CASE WHEN v_type = 'ride'
    THEN COALESCE((v_config->>'ridePerKmFee')::NUMERIC, (v_config->>'perKmFee')::NUMERIC, 10)
    ELSE COALESCE((v_config->>'perKmFee')::NUMERIC, 10) END;
  v_gp_rate := CASE v_type
    WHEN 'food' THEN COALESCE((v_config->>'gpDelivery')::NUMERIC, 15) / 100.0
    WHEN 'parcel' THEN COALESCE((v_config->>'gpDelivery')::NUMERIC, 15) / 100.0
    ELSE COALESCE((v_config->>'gpRide')::NUMERIC, 15) / 100.0 END;
  SELECT discount INTO v_discount FROM public.service_quotes WHERE id = v_quote_id FOR UPDATE;
  v_subtotal := v_base_fee + (v_billable_km * v_per_km_fee);
  v_grand_total := GREATEST(0, v_subtotal - COALESCE(v_discount, 0));
  v_admin_gp := ROUND(v_grand_total * v_gp_rate, 2);
  v_rider_income := CASE WHEN v_type = 'food' THEN v_subtotal ELSE ROUND(v_grand_total - v_admin_gp, 2) END;

  UPDATE public.service_quotes
  SET distance_meters = p_route_distance_meters, billable_km = v_billable_km,
      distance_source = 'osrm_road', base_fee = v_base_fee, per_km_fee = v_per_km_fee,
      subtotal = v_subtotal, grand_total = v_grand_total,
      admin_gp = v_admin_gp, rider_income = v_rider_income
  WHERE id = v_quote_id;

  RETURN v_quote || jsonb_build_object(
    'distanceMeters', p_route_distance_meters, 'billableKm', v_billable_km,
    'distanceSource', 'osrm_road', 'subtotal', v_subtotal, 'deliveryFee', v_subtotal,
    'grandTotal', v_grand_total, 'adminGP', v_admin_gp, 'riderIncome', v_rider_income
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_service_quote(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.create_service_quote(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.create_service_quote_from_route(TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_service_quote_from_route(TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO service_role;
