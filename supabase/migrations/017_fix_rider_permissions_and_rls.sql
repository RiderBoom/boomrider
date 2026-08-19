-- ══════════════════════════════════════════════════════════════════════════════
-- 017: Fix Rider Permissions & Order RLS Policies
-- Solves issue where riders cannot view or accept jobs due to RLS permissions
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Fix Orders SELECT Policy for Riders ────────────────────────────────────
-- Riders must be able to SELECT unassigned orders (pending / ready_to_pickup)
-- as well as orders assigned to them, so PostgreSQL allows them to view & accept jobs.

DROP POLICY IF EXISTS "rider_read_own_orders" ON public.orders;

CREATE POLICY "rider_read_own_orders" ON public.orders
  FOR SELECT TO authenticated
  USING (
    -- Unassigned orders (available for riders to accept)
    (data->>'riderId' IS NULL OR data->>'riderId' = '') OR
    -- Orders assigned to the logged-in rider
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = data->>'riderId'
        AND (r.user_id = auth.uid()::text OR r.data->>'userId' = auth.uid()::text)
    )
  );

-- ── 2. Fix Orders UPDATE Policy for Riders ────────────────────────────────────
-- Ensure riders can UPDATE unassigned orders when accepting them, and update assigned orders.

DROP POLICY IF EXISTS "rider_update_assigned_orders" ON public.orders;

CREATE POLICY "rider_update_assigned_orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (
    -- Can update if unassigned OR if currently assigned to them
    (data->>'riderId' IS NULL OR data->>'riderId' = '') OR
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = data->>'riderId'
        AND (r.user_id = auth.uid()::text OR r.data->>'userId' = auth.uid()::text)
    )
  )
  WITH CHECK (
    -- MUST be assigned to them after update OR admin
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = data->>'riderId'
        AND (r.user_id = auth.uid()::text OR r.data->>'userId' = auth.uid()::text)
    ) OR
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'
    )
  );

-- ── 3. Fix Riders Table RLS Policies ──────────────────────────────────────────
-- Allow all authenticated users to SELECT rider info (needed by customers, merchants, and subqueries).
-- Allow riders to UPDATE their own status (e.g. is_available toggle).

DROP POLICY IF EXISTS "riders_select" ON public.riders;
DROP POLICY IF EXISTS "riders_all" ON public.riders;
DROP POLICY IF EXISTS "riders_write" ON public.riders;

CREATE POLICY "riders_select" ON public.riders
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "riders_all" ON public.riders
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()::text OR
    data->>'userId' = auth.uid()::text OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()::text OR
    data->>'userId' = auth.uid()::text OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  );
