-- ══════════════════════════════════════════════════════════════════════════════
-- Fix RLS Policies for Security (Addressing Code Review)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Orders RLS Security Fix ────────────────────────────────────────────────
-- Remove the overly permissive orders_all policy
DROP POLICY IF EXISTS "orders_all" ON public.orders;

-- Implement granular and secure policies for Orders based on 002_realtime_orders_fix

-- Customers see their own orders
DROP POLICY IF EXISTS "customer_read_own_orders" ON orders;
CREATE POLICY "customer_read_own_orders" ON orders
  FOR SELECT USING (
    data->>'customerId' = auth.uid()::text
    OR data->>'userId' = auth.uid()::text -- Just in case it's called userId
  );

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

-- Admin sees everything
DROP POLICY IF EXISTS "admin_read_orders" ON orders;
CREATE POLICY "admin_read_orders" ON orders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  );

-- Allow authenticated users to INSERT orders (customer placing order)
DROP POLICY IF EXISTS "authenticated_insert_orders" ON orders;
CREATE POLICY "authenticated_insert_orders" ON orders
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow customers to UPDATE their own orders (e.g. cancelling)
DROP POLICY IF EXISTS "customer_update_own_orders" ON orders;
CREATE POLICY "customer_update_own_orders" ON orders
  FOR UPDATE USING (
    data->>'customerId' = auth.uid()::text
    OR data->>'userId' = auth.uid()::text
  )
  WITH CHECK (
    data->>'customerId' = auth.uid()::text
    OR data->>'userId' = auth.uid()::text
  );

-- Allow riders to UPDATE assigned orders
DROP POLICY IF EXISTS "rider_update_assigned_orders" ON orders;
CREATE POLICY "rider_update_assigned_orders" ON orders
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM riders r
      WHERE r.id = data->>'riderId'
        AND r.data->>'userId' = auth.uid()::text
    )
  );

-- Allow merchants to UPDATE orders for their restaurant
DROP POLICY IF EXISTS "merchant_update_own_orders" ON orders;
CREATE POLICY "merchant_update_own_orders" ON orders
  FOR UPDATE USING (
    data->>'restaurantOwnerId' = auth.uid()::text
  )
  WITH CHECK (
    data->>'restaurantOwnerId' = auth.uid()::text
  );

-- Allow admins to UPDATE all orders
DROP POLICY IF EXISTS "admin_update_orders" ON orders;
CREATE POLICY "admin_update_orders" ON orders
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  );

-- ── 2. App Config RLS Fix ─────────────────────────────────────────────────────
-- Ensure SELECT is allowed for all users so the frontend can load settings
DROP POLICY IF EXISTS "app_config_select" ON public.app_config;
CREATE POLICY "app_config_select" ON public.app_config FOR SELECT USING (true);

-- ── 3. Menu Items RLS Fix ─────────────────────────────────────────────────────
-- Remove the incorrect menu_items_all policy
DROP POLICY IF EXISTS "menu_items_all" ON public.menu_items;

-- Re-create properly
CREATE POLICY "menu_items_all" ON public.menu_items FOR ALL TO authenticated
USING (
  (EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE restaurants.id = menu_items.restaurant_id
    AND restaurants.owner_id = auth.uid()::text
  )) OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  (EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE restaurants.id = menu_items.restaurant_id
    AND restaurants.owner_id = auth.uid()::text
  )) OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);
