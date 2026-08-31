-- BoomRider security hardening, phase 1.
-- This migration changes policies/functions only. It does not update or delete
-- existing users, profiles, roles, wallets, restaurants, riders, or orders.

BEGIN;

-- Central database-side authorization check. Frontend environment variables are
-- deliberately not consulted for authorization.
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = p_user_id
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

-- New accounts are initialized server-side. Existing rows are left untouched.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, phone, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance, history)
  VALUES (NEW.id::text, 0, '[]'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_initialize_account ON auth.users;
CREATE TRIGGER on_auth_user_created_initialize_account
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;

-- Admin-only role changes. Prevent removing the caller's own admin role so an
-- accidental click cannot strand the installation without an administrator.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_role NOT IN ('customer', 'merchant', 'rider', 'admin') THEN
    RAISE EXCEPTION 'invalid_role_request' USING ERRCODE = '22023';
  END IF;

  IF p_enabled THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF p_user_id = auth.uid() AND p_role = 'admin' THEN
      RAISE EXCEPTION 'cannot_remove_own_admin_role' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, boolean) TO authenticated;

-- Preserve the existing browser RPC name for compatibility, but enforce:
--   * admins may adjust any wallet;
--   * normal users may only debit their own wallet;
--   * balance can never become negative.
-- Positive self-credit, cross-account changes, NaN-like values, and zero-value
-- writes are rejected. Settlement RPCs continue to use the private helper.
CREATE OR REPLACE FUNCTION public.js_credit_wallet(
  p_user_id text,
  p_amount numeric,
  p_entry jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid text;
  v_current numeric;
  v_is_admin boolean := public.is_admin(auth.uid());
  v_entry jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'invalid_wallet_adjustment' USING ERRCODE = '22023';
  END IF;

  IF p_user_id LIKE '%@%' THEN
    SELECT id::text INTO v_uid
    FROM public.profiles
    WHERE lower(email) = lower(p_user_id)
    LIMIT 1;
  ELSE
    v_uid := p_user_id;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'wallet_owner_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_is_admin AND (v_uid <> auth.uid()::text OR p_amount > 0) THEN
    RAISE EXCEPTION 'wallet_adjustment_not_allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.wallets (user_id, balance, history)
  VALUES (v_uid, 0, '[]'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_current
  FROM public.wallets
  WHERE user_id = v_uid
  FOR UPDATE;

  IF COALESCE(v_current, 0) + p_amount < 0 THEN
    RAISE EXCEPTION 'insufficient_wallet_balance' USING ERRCODE = '22003';
  END IF;

  v_entry := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'type', CASE WHEN p_amount > 0 THEN 'deposit' ELSE 'withdraw' END,
    'amount', p_amount,
    'date', to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
    'desc', left(COALESCE(p_entry->>'desc', 'Wallet adjustment'), 300),
    'createdAtMs', (extract(epoch FROM now()) * 1000)::bigint,
    'actorUserId', auth.uid()::text
  );

  UPDATE public.wallets
  SET balance = balance + p_amount,
      history = jsonb_build_array(v_entry) || COALESCE(history, '[]'::jsonb)
  WHERE user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.js_credit_wallet(text, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.js_credit_wallet(text, numeric, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_wallet_history(p_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id <> auth.uid()::text AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'wallet_access_denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.wallets SET history = '[]'::jsonb WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_wallet_history(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_wallet_history(text) TO authenticated;

-- Notification creation no longer requires broad INSERT access to the table.
CREATE OR REPLACE FUNCTION public.create_admin_notification(
  p_title text,
  p_message text,
  p_type text DEFAULT 'info'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.admin_notifs (id, title, message, type, at)
  VALUES (
    v_id,
    left(COALESCE(p_title, ''), 160),
    left(COALESCE(p_message, ''), 1000),
    CASE WHEN p_type IN ('info', 'success', 'warning', 'error') THEN p_type ELSE 'info' END,
    to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS')
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_notification(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_admin_notification(text, text, text) TO authenticated;

-- Profiles: own row or admin. Users cannot change another profile or use a
-- client update to set administrative fields on another account.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_all" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (id = auth.uid() OR public.is_admin(auth.uid()));

-- Roles: readable by the owner/admin, writable only through admin_set_user_role.
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_all" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_update" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_delete" ON public.user_roles;
CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- Wallet rows are read-only to clients; all balance writes go through checked RPCs.
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallets_all" ON public.wallets;
DROP POLICY IF EXISTS "wallet_own_read" ON public.wallets;
DROP POLICY IF EXISTS "wallet_own_write" ON public.wallets;
DROP POLICY IF EXISTS "wallets_select" ON public.wallets;
DROP POLICY IF EXISTS "wallets_insert" ON public.wallets;
DROP POLICY IF EXISTS "wallets_update" ON public.wallets;
DROP POLICY IF EXISTS "wallets_delete" ON public.wallets;
CREATE POLICY "wallets_select_own_or_admin" ON public.wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text OR public.is_admin(auth.uid()));

-- Requests carry the legacy owner in JSONB; preserve data shape while enforcing it.
ALTER TABLE public.pending_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pending_requests_all" ON public.pending_requests;
DROP POLICY IF EXISTS "pending_requests_select" ON public.pending_requests;
DROP POLICY IF EXISTS "pending_requests_insert" ON public.pending_requests;
DROP POLICY IF EXISTS "pending_requests_update" ON public.pending_requests;
DROP POLICY IF EXISTS "pending_requests_delete" ON public.pending_requests;
CREATE POLICY "pending_requests_select_own_or_admin" ON public.pending_requests
  FOR SELECT TO authenticated
  USING (data->>'userId' = auth.uid()::text OR public.is_admin(auth.uid()));
CREATE POLICY "pending_requests_insert_own" ON public.pending_requests
  FOR INSERT TO authenticated
  WITH CHECK (data->>'userId' = auth.uid()::text);
CREATE POLICY "pending_requests_admin_update" ON public.pending_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "pending_requests_admin_delete" ON public.pending_requests
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

ALTER TABLE public.admin_notifs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_notifs_all" ON public.admin_notifs;
DROP POLICY IF EXISTS "admin_notifs_select" ON public.admin_notifs;
DROP POLICY IF EXISTS "admin_notifs_insert" ON public.admin_notifs;
DROP POLICY IF EXISTS "admin_notifs_update" ON public.admin_notifs;
DROP POLICY IF EXISTS "admin_notifs_delete" ON public.admin_notifs;
CREATE POLICY "admin_notifs_admin_select" ON public.admin_notifs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admin_notifs_admin_delete" ON public.admin_notifs
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "promo_codes_write" ON public.promo_codes;
DROP POLICY IF EXISTS "promo_codes_all" ON public.promo_codes;
CREATE POLICY "promo_codes_admin_write" ON public.promo_codes
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- app_config_select from prior migrations remains available to the app.
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_config_write" ON public.app_config;
DROP POLICY IF EXISTS "app_config_all" ON public.app_config;
CREATE POLICY "app_config_admin_write" ON public.app_config
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMIT;

