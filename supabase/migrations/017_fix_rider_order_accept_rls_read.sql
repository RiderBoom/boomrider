-- ══════════════════════════════════════════════════════════════════════════════
-- Fix Rider Read Unassigned Orders RLS Policy
-- ══════════════════════════════════════════════════════════════════════════════

-- Riders need to SELECT unassigned orders (status 'pending' or 'ready_to_pickup')
-- so that when they click "Accept Job" (`acceptOrder`), the `UPDATE ... .select('id')`
-- query in Supabase can find and return the target row instead of failing with 0 updated rows.

DROP POLICY IF EXISTS "rider_read_own_orders" ON orders;

CREATE POLICY "rider_read_own_orders" ON orders
  FOR SELECT USING (
    -- Can read if unassigned pending/ready_to_pickup order OR if assigned to them
    ((data->>'riderId' IS NULL OR data->>'riderId' = '') AND status IN ('pending', 'ready_to_pickup'))
    OR
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    )
  );
