-- ══════════════════════════════════════════════════════════════════════════════
-- Fix Rider Accept Order RLS
-- ══════════════════════════════════════════════════════════════════════════════

-- The previous policy created a catch-22: a rider couldn't accept a pending order
-- because the existing row didn't yet have their riderId. We must allow riders
-- to UPDATE an order if it is unassigned, provided the new row correctly assigns it to them.

DROP POLICY IF EXISTS "rider_update_assigned_orders" ON orders;

CREATE POLICY "rider_update_assigned_orders" ON orders
  FOR UPDATE USING (
    -- Can update if currently assigned to them OR if unassigned (pending/ready)
    (data->>'riderId' IS NULL) OR
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    )
  )
  WITH CHECK (
    -- MUST be assigned to them after the update
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    )
  );
