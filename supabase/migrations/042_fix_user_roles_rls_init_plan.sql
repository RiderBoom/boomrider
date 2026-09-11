-- Migration 042: Fix Auth RLS Initialization Plan performance issue on public.user_roles and key tables.
-- Replaces direct auth.<func>() calls in RLS policies with scalar subqueries (SELECT auth.<func>())
-- to enable query optimizer caching and prevent per-row evaluation.

BEGIN;

-- 1. Fix public.user_roles RLS Policy
DROP POLICY IF EXISTS "user_roles_select_own_or_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_all" ON public.user_roles;

CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid()))
  );

-- Ensure index exists on public.user_roles(user_id) to optimize RLS filtering
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id);

-- 2. Fix public.profiles RLS Policies
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;

CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid()))
  );

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = (SELECT auth.uid())
  );

CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid()))
  );

-- 3. Fix public.wallets RLS Policies
DROP POLICY IF EXISTS "wallets_select_own_or_admin" ON public.wallets;

CREATE POLICY "wallets_select_own_or_admin" ON public.wallets
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())::text OR public.is_admin((SELECT auth.uid()))
  );

-- 4. Fix public.pending_requests RLS Policies
DROP POLICY IF EXISTS "pending_requests_select_own_or_admin" ON public.pending_requests;
DROP POLICY IF EXISTS "pending_requests_insert_own" ON public.pending_requests;
DROP POLICY IF EXISTS "pending_requests_admin_update" ON public.pending_requests;
DROP POLICY IF EXISTS "pending_requests_admin_delete" ON public.pending_requests;

CREATE POLICY "pending_requests_select_own_or_admin" ON public.pending_requests
  FOR SELECT TO authenticated
  USING (
    data->>'userId' = (SELECT auth.uid())::text OR public.is_admin((SELECT auth.uid()))
  );

CREATE POLICY "pending_requests_insert_own" ON public.pending_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    data->>'userId' = (SELECT auth.uid())::text
  );

CREATE POLICY "pending_requests_admin_update" ON public.pending_requests
  FOR UPDATE TO authenticated
  USING (
    public.is_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_admin((SELECT auth.uid()))
  );

CREATE POLICY "pending_requests_admin_delete" ON public.pending_requests
  FOR DELETE TO authenticated
  USING (
    public.is_admin((SELECT auth.uid()))
  );

-- 5. Fix public.admin_notifs RLS Policies
DROP POLICY IF EXISTS "admin_notifs_admin_select" ON public.admin_notifs;
DROP POLICY IF EXISTS "admin_notifs_admin_delete" ON public.admin_notifs;

CREATE POLICY "admin_notifs_admin_select" ON public.admin_notifs
  FOR SELECT TO authenticated
  USING (
    public.is_admin((SELECT auth.uid()))
  );

CREATE POLICY "admin_notifs_admin_delete" ON public.admin_notifs
  FOR DELETE TO authenticated
  USING (
    public.is_admin((SELECT auth.uid()))
  );

-- 6. Fix public.promo_codes RLS Policies
DROP POLICY IF EXISTS "promo_codes_admin_write" ON public.promo_codes;

CREATE POLICY "promo_codes_admin_write" ON public.promo_codes
  FOR ALL TO authenticated
  USING (
    public.is_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_admin((SELECT auth.uid()))
  );

-- 7. Fix public.app_config RLS Policies
DROP POLICY IF EXISTS "app_config_admin_write" ON public.app_config;

CREATE POLICY "app_config_admin_write" ON public.app_config
  FOR ALL TO authenticated
  USING (
    public.is_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_admin((SELECT auth.uid()))
  );

-- 8. Fix public.service_quotes RLS Policies
DROP POLICY IF EXISTS "service_quotes_select_own_or_admin" ON public.service_quotes;

CREATE POLICY "service_quotes_select_own_or_admin" ON public.service_quotes
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())::text OR public.is_admin((SELECT auth.uid()))
  );

-- 9. Fix public.wallet_ledger_entries RLS Policies
DROP POLICY IF EXISTS "wallet_ledger_read_own_or_admin" ON public.wallet_ledger_entries;

CREATE POLICY "wallet_ledger_read_own_or_admin" ON public.wallet_ledger_entries
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())::text OR public.is_admin((SELECT auth.uid()))
  );

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';

COMMIT;
