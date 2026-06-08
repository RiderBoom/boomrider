-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Fix: Customer Order Status Updates via Realtime
-- Run this in Supabase SQL Editor after 001_grab_dispatch_engine.sql
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Step 1: Add orders to Supabase Realtime publication ───────────────────────
-- Without this, NO Realtime events fire for order INSERT/UPDATE/DELETE.
-- This is almost certainly why the customer's order status never updates.
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- ── Step 2: Enable full row data in Realtime UPDATE events ────────────────────
-- With DEFAULT identity, Supabase only sends the primary key in payload.old.
-- With FULL, payload.new contains ALL columns so the JS fallback fetch isn't needed.
ALTER TABLE orders REPLICA IDENTITY FULL;

-- ── Step 3: Ensure orders table has a top-level status column ─────────────────
-- The polling query uses `.in('status', [...])` which requires this column.
-- Skip if it already exists.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- ── Step 4: RLS — let customers, riders, and merchants read their own orders ──
-- Run ONLY if RLS is enabled on orders. If SELECT returns rows already, skip.
-- Uncomment the block below if customers cannot see their orders:

/*
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Customers see their own orders
DROP POLICY IF EXISTS "customer_read_own_orders" ON orders;
CREATE POLICY "customer_read_own_orders" ON orders
  FOR SELECT USING (data->>'customerId' = auth.uid()::text);

-- Riders see orders assigned to them (by riderId inside data JSONB)
DROP POLICY IF EXISTS "rider_read_own_orders" ON orders;
CREATE POLICY "rider_read_own_orders" ON orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    )
  );

-- Merchants see orders for their restaurant
DROP POLICY IF EXISTS "merchant_read_own_orders" ON orders;
CREATE POLICY "merchant_read_own_orders" ON orders
  FOR SELECT USING (
    data->>'restaurantOwnerId' = auth.uid()::text
  );

-- Allow authenticated users to INSERT orders (customer placing order)
DROP POLICY IF EXISTS "authenticated_insert_orders" ON orders;
CREATE POLICY "authenticated_insert_orders" ON orders
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to UPDATE orders they can see
DROP POLICY IF EXISTS "authenticated_update_orders" ON orders;
CREATE POLICY "authenticated_update_orders" ON orders
  FOR UPDATE USING (
    data->>'customerId' = auth.uid()::text
    OR data->>'restaurantOwnerId' = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    )
  );
*/
