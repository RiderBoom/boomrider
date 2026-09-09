-- Migration 040: Sync auth.users to profiles, wallets, and user_roles
-- Provides authoritative backfill and RPC to ensure auth.users and public.profiles stay 100% in sync.

BEGIN;

-- 1. Backfill all existing auth.users into profiles, wallets, and user_roles
INSERT INTO public.profiles (id, name, phone, email)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'name', ''),
  NULLIF(raw_user_meta_data->>'phone', ''),
  email
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = CASE WHEN public.profiles.name IS NULL OR public.profiles.name = '' THEN EXCLUDED.name ELSE public.profiles.name END;

INSERT INTO public.wallets (user_id, balance, history)
SELECT id::text, 0, '[]'::jsonb
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'customer'
FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. Create RPC function for admins to trigger auth.users sync on demand
CREATE OR REPLACE FUNCTION public.admin_sync_auth_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (id, name, phone, email)
  SELECT
    id,
    COALESCE(raw_user_meta_data->>'name', ''),
    NULLIF(raw_user_meta_data->>'phone', ''),
    email
  FROM auth.users
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = CASE WHEN public.profiles.name IS NULL OR public.profiles.name = '' THEN EXCLUDED.name ELSE public.profiles.name END;

  INSERT INTO public.wallets (user_id, balance, history)
  SELECT id::text, 0, '[]'::jsonb
  FROM auth.users
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'customer'
  FROM auth.users
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_sync_auth_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_sync_auth_users() TO authenticated;

COMMIT;
