-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Migration 045: Server-side Auto-Completion for Delivered Orders
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_complete_delivered_orders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec        RECORD;
  v_count      INT := 0;
  v_gp_food    NUMERIC;
  v_gp_deliv   NUMERIC;
  v_gp_ride    NUMERIC;
  v_gp_service NUMERIC;
BEGIN
  -- Get active GP rates from app_config (fallback to defaults if missing)
  SELECT
    COALESCE((data->>'gpFood')::NUMERIC / 100.0, 0.30),
    COALESCE((data->>'gpDelivery')::NUMERIC / 100.0, 0.15),
    COALESCE((data->>'gpRide')::NUMERIC / 100.0, 0.15),
    COALESCE((data->>'gpService')::NUMERIC / 100.0, 0.15)
  INTO v_gp_food, v_gp_deliv, v_gp_ride, v_gp_service
  FROM app_config WHERE id = 1;

  IF v_gp_food IS NULL THEN v_gp_food := 0.30; END IF;
  IF v_gp_deliv IS NULL THEN v_gp_deliv := 0.15; END IF;
  IF v_gp_ride IS NULL THEN v_gp_ride := 0.15; END IF;
  IF v_gp_service IS NULL THEN v_gp_service := 0.15; END IF;

  FOR v_rec IN
    SELECT id, data FROM orders
    WHERE status = 'delivered'
      AND (
        COALESCE(
          (data->>'deliveredAtMs')::BIGINT,
          EXTRACT(EPOCH FROM (data->>'deliveredAt')::TIMESTAMPTZ) * 1000
        ) <= (EXTRACT(EPOCH FROM now()) * 1000 - 15 * 60 * 1000)
      )
      AND COALESCE(data->>'settlementStatus', '') <> 'settled'
  LOOP
    PERFORM public.process_order_settlement_internal(
      v_rec.id,
      v_gp_food,
      v_gp_deliv,
      v_gp_ride,
      v_gp_service
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_complete_delivered_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_complete_delivered_orders() TO authenticated, service_role;

-- Also integrate auto_complete_delivered_orders execution into process_expired_offers
CREATE OR REPLACE FUNCTION public.process_expired_offers()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec   RECORD;
  v_data  JSONB;
  v_count INT := 0;
BEGIN
  -- 1. Expire timed out job offers
  FOR v_rec IN
    UPDATE job_offers
    SET status = 'timeout', responded_at = now()
    WHERE status = 'pending' AND expires_at < now()
    RETURNING order_id
  LOOP
    SELECT data INTO v_data FROM orders WHERE id = v_rec.order_id;
    IF v_data->>'status' IN ('pending', 'ready_to_pickup') THEN
      PERFORM dispatch_order(
        v_rec.order_id,
        (v_data->'pickupLocation'->>'lat')::FLOAT,
        (v_data->'pickupLocation'->>'lng')::FLOAT
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  -- 2. Auto-complete unconfirmed delivered orders older than 15 minutes
  PERFORM public.auto_complete_delivered_orders();

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_expired_offers() TO service_role;
