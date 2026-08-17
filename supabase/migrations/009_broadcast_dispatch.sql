-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Broadcast Dispatch & First-Come-First-Served Acceptance
-- ══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ── 1. Update dispatch_order to broadcast to ALL eligible riders ──────────────
CREATE OR REPLACE FUNCTION dispatch_order(
  p_order_id   TEXT,
  p_pickup_lat FLOAT,
  p_pickup_lng FLOAT,
  p_radius_km  FLOAT DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt    INT;
  v_inserted   INT := 0;
BEGIN
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

  -- Determine attempt number (recursive loop counter)
  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_attempt
  FROM job_offers WHERE order_id = p_order_id;

  -- ── Insert job offer for ALL available riders within radius ──────────────
  WITH eligible_riders AS (
    SELECT
      r.id                      AS rider_id,
      r.data->>'userId'         AS rider_user_id
    FROM riders r
    WHERE r.is_available = true
      AND r.current_lat  IS NOT NULL
      AND r.current_lng  IS NOT NULL
      -- Exclude riders who already received an offer (any status) for this order
      AND NOT EXISTS (
        SELECT 1 FROM job_offers jo
        WHERE jo.order_id  = p_order_id
          AND jo.rider_id  = r.id
      )
      -- Within configured radius
      AND earth_distance(
            ll_to_earth(r.current_lat, r.current_lng),
            ll_to_earth(p_pickup_lat, p_pickup_lng)
          ) / 1000.0 <= p_radius_km
  )
  INSERT INTO job_offers (order_id, rider_id, rider_user_id, attempt_no)
  SELECT p_order_id, rider_id, rider_user_id, v_attempt
  FROM eligible_riders;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- ── No riders available ─────────────────────────────────────────────────
  IF v_inserted = 0 THEN
    UPDATE orders
    SET data = data || '{"dispatchStatus":"no_rider_available"}'::jsonb
    WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'ok',      false,
      'reason',  'no_rider_available',
      'attempt', v_attempt
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'offers_count', v_inserted,
    'attempt',      v_attempt
  );
END;
$$;


-- ── 2. Create accept_job_offer RPC for First-Come-First-Served ─────────────
CREATE OR REPLACE FUNCTION accept_job_offer(p_offer_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
  v_updated BOOLEAN := false;
BEGIN
  -- 1. Read the offer first without lock
  SELECT * INTO v_offer
  FROM job_offers
  WHERE id = p_offer_id;

  -- Verify offer exists and is still pending
  IF v_offer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_found');
  END IF;

  IF v_offer.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_pending');
  END IF;

  IF v_offer.expires_at < now() THEN
     RETURN jsonb_build_object('ok', false, 'reason', 'offer_expired');
  END IF;

  -- 2. Lock the parent order to serialize all concurrent accept attempts globally
  PERFORM 1 FROM orders WHERE id = v_offer.order_id FOR UPDATE;

  -- 3. Lock the specific offer
  SELECT * INTO v_offer
  FROM job_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  -- Double check that no one else has accepted THIS ORDER yet
  IF EXISTS (
    SELECT 1 FROM job_offers
    WHERE order_id = v_offer.order_id AND status = 'accepted'
  ) THEN
    -- Someone else beat them to it. Mark this one as missed.
    UPDATE job_offers
    SET status = 'missed', responded_at = now()
    WHERE id = p_offer_id;

    RETURN jsonb_build_object('ok', false, 'reason', 'already_accepted_by_other');
  END IF;

  -- ── All good! Accept this offer ──────────────────────────────────────────
  UPDATE job_offers
  SET status = 'accepted', responded_at = now()
  WHERE id = p_offer_id;

  -- Mark all OTHER pending offers for this order as 'missed'
  UPDATE job_offers
  SET status = 'missed', responded_at = now()
  WHERE order_id = v_offer.order_id
    AND id != p_offer_id
    AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'order_id', v_offer.order_id);
END;
$$;

-- Grant execution rights to frontend via supabase.rpc()
GRANT EXECUTE ON FUNCTION accept_job_offer(UUID) TO authenticated;
