-- ══════════════════════════════════════════════════════════════════════════════
-- Production-ready RLS Policies for Core Tables
-- Fixes "new row violates row-level security policy" (42501)
-- Restricts SELECT, INSERT, UPDATE, DELETE to authenticated users & owners
-- ══════════════════════════════════════════════════════════════════════════════

-- Ensure RLS is enabled
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

-- ── Restaurants ───────────────────────────────────────────────────────────────
-- Clean up old policies
DROP POLICY IF EXISTS "restaurants_select" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_write" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_all" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_insert" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_update" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_delete" ON public.restaurants;

-- Read policy (owners and admins)
CREATE POLICY "restaurants_select" ON public.restaurants FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()::text OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- Write policy (owners and admins)
CREATE POLICY "restaurants_all" ON public.restaurants FOR ALL TO authenticated
USING (
  owner_id = auth.uid()::text OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  owner_id = auth.uid()::text OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- ── Menu Items ───────────────────────────────────────────────────────────────
-- Clean up old policies
DROP POLICY IF EXISTS "menu_items_select" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_write" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_all" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_insert" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_update" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_delete" ON public.menu_items;

-- Read policy (owners and admins)
CREATE POLICY "menu_items_select" ON public.menu_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE restaurants.id = menu_items.restaurant_id
    AND restaurants.owner_id = auth.uid()::text
  ) OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- Write policy (owners and admins)
CREATE POLICY "menu_items_all" ON public.menu_items FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE restaurants.id = menu_items.restaurant_id
    AND restaurants.owner_id = auth.uid()::text
  ) OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE restaurants.id = menu_items.restaurant_id
    AND restaurants.owner_id = auth.uid()::text
  ) OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- ── App Config ───────────────────────────────────────────────────────────────
-- Clean up old policies
DROP POLICY IF EXISTS "app_config_select" ON public.app_config;
DROP POLICY IF EXISTS "app_config_write" ON public.app_config;
DROP POLICY IF EXISTS "app_config_all" ON public.app_config;
DROP POLICY IF EXISTS "app_config_insert" ON public.app_config;
DROP POLICY IF EXISTS "app_config_update" ON public.app_config;
DROP POLICY IF EXISTS "app_config_delete" ON public.app_config;

-- Read policy (allow authenticated users since it contains public settings like map key)
-- Usually app configs need to be read by all authenticated users to use the app
CREATE POLICY "app_config_select" ON public.app_config FOR SELECT TO authenticated USING (true);

-- Write policy (admins only)
CREATE POLICY "app_config_all" ON public.app_config FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- ── Riders ───────────────────────────────────────────────────────────────────
-- Clean up old policies
DROP POLICY IF EXISTS "riders_select" ON public.riders;
DROP POLICY IF EXISTS "riders_write" ON public.riders;
DROP POLICY IF EXISTS "riders_all" ON public.riders;
DROP POLICY IF EXISTS "riders_insert" ON public.riders;
DROP POLICY IF EXISTS "riders_update" ON public.riders;
DROP POLICY IF EXISTS "riders_delete" ON public.riders;

-- Read policy (owners and admins)
CREATE POLICY "riders_select" ON public.riders FOR SELECT TO authenticated
USING (
  user_id = auth.uid()::text OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);

-- Write policy (owners and admins)
CREATE POLICY "riders_all" ON public.riders FOR ALL TO authenticated
USING (
  user_id = auth.uid()::text OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  user_id = auth.uid()::text OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);
