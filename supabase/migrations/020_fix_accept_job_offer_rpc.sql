-- ══════════════════════════════════════════════════════════════════════════════
-- Fix accept_job_offer RPC: correct record field access and return order_data
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION accept_job_offer(p_offer_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
  v_order RECORD;
  v_rider RECORD;
  v_now_str TEXT;
  v_updated_order JSONB;
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
  SELECT * INTO v_order FROM orders WHERE id = v_offer.order_id FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- 3. Lock the specific offer
  SELECT * INTO v_offer
  FROM job_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  -- Verify offer is still pending after acquiring lock
  IF v_offer.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_pending');
  END IF;

  -- Double check that no one else has accepted THIS ORDER yet (exclude current offer to prevent self-rejections)
  IF EXISTS (
    SELECT 1 FROM job_offers
    WHERE order_id = v_offer.order_id AND status = 'accepted' AND id != p_offer_id
  ) THEN
    -- Someone else beat them to it. Mark this one as missed.
    UPDATE job_offers
    SET status = 'missed', responded_at = now()
    WHERE id = p_offer_id;

    RETURN jsonb_build_object('ok', false, 'reason', 'already_accepted_by_other');
  END IF;

  -- Fetch rider info
  SELECT * INTO v_rider FROM riders WHERE id = v_offer.rider_id;

  v_now_str := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS');

  -- Build updated order JSONB
  v_updated_order := v_order.data || jsonb_build_object(
    'status', 'rider_accepted',
    'riderId', v_offer.rider_id,
    'riderUserId', v_offer.rider_user_id,
    'riderName', COALESCE(v_rider.data->>'name', 'ไรเดอร์'),
    'riderPhone', COALESCE(v_rider.data->>'phone', ''),
    'riderAcceptedAt', v_now_str
  );

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

  -- Update orders table directly inside PostgreSQL
  UPDATE orders
  SET status = 'rider_accepted',
      data = v_updated_order
  WHERE id = v_offer.order_id;

  -- Mark rider as unavailable
  IF v_offer.rider_id IS NOT NULL THEN
    UPDATE riders SET is_available = false WHERE id = v_offer.rider_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_offer.order_id, 'order_data', v_updated_order);
END;
$$;

GRANT EXECUTE ON FUNCTION accept_job_offer(UUID) TO authenticated;
