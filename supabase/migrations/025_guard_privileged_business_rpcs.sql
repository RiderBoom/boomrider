-- Guard legacy SECURITY DEFINER functions without changing business data.
BEGIN;

-- Existing implementations are retained as private internals so their business
-- behavior stays unchanged; public wrappers add participant authorization.
ALTER FUNCTION public.accept_job_offer(uuid) RENAME TO accept_job_offer_internal;
REVOKE ALL ON FUNCTION public.accept_job_offer_internal(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.accept_job_offer(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT rider_user_id INTO v_owner FROM public.job_offers WHERE id = p_offer_id;
  IF v_owner IS NULL OR (v_owner <> auth.uid() AND NOT public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'offer_access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN public.accept_job_offer_internal(p_offer_id);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_job_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_job_offer(uuid) TO authenticated;

ALTER FUNCTION public.dispatch_order(text, double precision, double precision, double precision)
  RENAME TO dispatch_order_internal;
REVOKE ALL ON FUNCTION public.dispatch_order_internal(text, double precision, double precision, double precision)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.dispatch_order(
  p_order_id text,
  p_pickup_lat double precision DEFAULT NULL,
  p_pickup_lng double precision DEFAULT NULL,
  p_radius_km double precision DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT data INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF NOT public.is_admin(auth.uid())
     AND auth.uid()::text NOT IN (
       COALESCE(v_order->>'customerId', ''),
       COALESCE(v_order->>'userId', ''),
       COALESCE(v_order->>'restaurantOwnerId', ''),
       COALESCE(v_order->>'riderUserId', '')
     )
  THEN
    RAISE EXCEPTION 'order_access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN public.dispatch_order_internal(p_order_id, p_pickup_lat, p_pickup_lng, p_radius_km);
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_order(text, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_order(text, double precision, double precision, double precision) TO authenticated;

ALTER FUNCTION public.process_order_settlement(text, numeric, numeric, numeric, numeric)
  RENAME TO process_order_settlement_internal;
REVOKE ALL ON FUNCTION public.process_order_settlement_internal(text, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;

-- Revoke obsolete overloads that could otherwise bypass the guarded version.
REVOKE ALL ON FUNCTION public.process_order_settlement(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.process_order_settlement(
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
DECLARE v_order jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT data INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'order_not_found'); END IF;
  IF NOT public.is_admin(auth.uid())
     AND auth.uid()::text NOT IN (
       COALESCE(v_order->>'customerId', ''),
       COALESCE(v_order->>'userId', ''),
       COALESCE(v_order->>'restaurantOwnerId', ''),
       COALESCE(v_order->>'riderUserId', '')
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

ALTER FUNCTION public.append_chat_message(text, jsonb) RENAME TO append_chat_message_internal;
REVOKE ALL ON FUNCTION public.append_chat_message_internal(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.append_chat_message(p_order_id text, p_message jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT data INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL OR (
    NOT public.is_admin(auth.uid())
    AND auth.uid()::text NOT IN (
      COALESCE(v_order->>'customerId', ''),
      COALESCE(v_order->>'userId', ''),
      COALESCE(v_order->>'restaurantOwnerId', ''),
      COALESCE(v_order->>'riderUserId', '')
    )
  ) THEN
    RAISE EXCEPTION 'chat_access_denied' USING ERRCODE = '42501';
  END IF;
  p_message := p_message || jsonb_build_object('senderUserId', auth.uid()::text);
  PERFORM public.append_chat_message_internal(p_order_id, p_message);
END;
$$;
REVOKE ALL ON FUNCTION public.append_chat_message(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_chat_message(text, jsonb) TO authenticated;

COMMIT;

