-- ══════════════════════════════════════════════════════════════════════════════
-- Fix Rider Accept Order & RLS Policy for Dispatched Orders
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Update accept_job_offer RPC to update orders & riders atomically ──────
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
      data = data || jsonb_build_object(
        'status', 'rider_accepted',
        'riderId', v_offer.rider_id,
        'riderUserId', v_offer.rider_user_id,
        'riderName', COALESCE(v_rider.data->>'name', v_rider.name, 'ไรเดอร์'),
        'riderPhone', COALESCE(v_rider.data->>'phone', v_rider.phone, ''),
        'riderAcceptedAt', v_now_str
      )
  WHERE id = v_offer.order_id;

  -- Mark rider as unavailable
  IF v_offer.rider_id IS NOT NULL THEN
    UPDATE riders SET is_available = false WHERE id = v_offer.rider_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_offer.order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION accept_job_offer(UUID) TO authenticated;


-- ── 2. Update Rider SELECT RLS policy to include 'preparing' status ───────────
DROP POLICY IF EXISTS "rider_read_own_orders" ON orders;

CREATE POLICY "rider_read_own_orders" ON orders
  FOR SELECT USING (
    -- Can read if unassigned (pending/preparing/ready_to_pickup) OR if assigned to them
    (((data->>'riderId' IS NULL OR data->>'riderId' = '') AND status IN ('pending', 'preparing', 'ready_to_pickup'))
    OR
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    ))
  );


-- ── 3. Update Rider UPDATE RLS policy to allow accepting unassigned orders ───
DROP POLICY IF EXISTS "rider_update_assigned_orders" ON orders;

CREATE POLICY "rider_update_assigned_orders" ON orders
  FOR UPDATE USING (
    -- Can update if unassigned (pending/preparing/ready_to_pickup/rider_accepted) OR if assigned to them
    (((data->>'riderId' IS NULL OR data->>'riderId' = '') AND status IN ('pending', 'preparing', 'ready_to_pickup', 'rider_accepted'))
    OR
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    ))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    )
  );
