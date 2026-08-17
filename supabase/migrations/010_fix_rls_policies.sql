-- ══════════════════════════════════════════════════════════════════════════════
-- Fix RLS Policies for restaurants, menu_items, and app_config
-- Fixes "new row violates row-level security policy" (42501)
-- ══════════════════════════════════════════════════════════════════════════════

-- Ensure RLS is enabled for these tables
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- ── Restaurants ───────────────────────────────────────────────────────────────
-- Clean up old policies
DROP POLICY IF EXISTS "restaurants_write" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_all" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_insert" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_update" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_delete" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_select" ON public.restaurants;

-- Read policy (allow all)
CREATE POLICY "restaurants_select" ON public.restaurants FOR SELECT USING (true);

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
DROP POLICY IF EXISTS "menu_items_write" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_all" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_insert" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_update" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_delete" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_select" ON public.menu_items;

-- Read policy (allow all)
CREATE POLICY "menu_items_select" ON public.menu_items FOR SELECT USING (true);

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
DROP POLICY IF EXISTS "app_config_write" ON public.app_config;
DROP POLICY IF EXISTS "app_config_all" ON public.app_config;
DROP POLICY IF EXISTS "app_config_insert" ON public.app_config;
DROP POLICY IF EXISTS "app_config_update" ON public.app_config;
DROP POLICY IF EXISTS "app_config_delete" ON public.app_config;
DROP POLICY IF EXISTS "app_config_select" ON public.app_config;

-- Read policy (allow all)
CREATE POLICY "app_config_select" ON public.app_config FOR SELECT USING (true);

-- Write policy (admins only)
CREATE POLICY "app_config_all" ON public.app_config FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
);
