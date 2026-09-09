-- Migration 040: restore complete account initialization and repair orphaned auth users.
-- Production drift left auth.users + wallets rows without profiles/user_roles.
-- This migration is idempotent and never overwrites a non-empty profile field or wallet balance.

BEGIN;

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
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'name'), ''),
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      ''
    ),
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'phone'), ''),
      NULLIF(BTRIM(NEW.phone), '')
    ),
    NULLIF(BTRIM(NEW.email), '')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name = CASE
      WHEN NULLIF(BTRIM(public.profiles.name), '') IS NULL
        THEN EXCLUDED.name
      ELSE public.profiles.name
    END,
    phone = CASE
      WHEN NULLIF(BTRIM(public.profiles.phone), '') IS NULL
        THEN EXCLUDED.phone
      ELSE public.profiles.phone
    END,
    email = CASE
      WHEN NULLIF(BTRIM(public.profiles.email), '') IS NULL
        THEN EXCLUDED.email
      ELSE public.profiles.email
    END;

  INSERT INTO public.wallets (user_id, balance, history)
  VALUES (NEW.id::text, 0, '[]'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

-- Remove the production-only wallet trigger and any prior consolidated trigger,
-- then leave exactly one initializer for future signups.
DROP TRIGGER IF EXISTS on_auth_user_created_wallet ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_initialize_account ON auth.users;
CREATE TRIGGER on_auth_user_created_initialize_account
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- Repair every existing auth account. Existing names/phones/emails are preserved
-- unless blank, and existing wallet rows/balances/history are never updated.
INSERT INTO public.profiles (id, name, phone, email)
SELECT
  u.id,
  COALESCE(
    NULLIF(BTRIM(u.raw_user_meta_data->>'name'), ''),
    NULLIF(BTRIM(u.raw_user_meta_data->>'full_name'), ''),
    ''
  ),
  COALESCE(
    NULLIF(BTRIM(u.raw_user_meta_data->>'phone'), ''),
    NULLIF(BTRIM(u.phone), '')
  ),
  NULLIF(BTRIM(u.email), '')
FROM auth.users AS u
ON CONFLICT (id) DO UPDATE
SET
  name = CASE
    WHEN NULLIF(BTRIM(public.profiles.name), '') IS NULL
      THEN EXCLUDED.name
    ELSE public.profiles.name
  END,
  phone = CASE
    WHEN NULLIF(BTRIM(public.profiles.phone), '') IS NULL
      THEN EXCLUDED.phone
    ELSE public.profiles.phone
  END,
  email = CASE
    WHEN NULLIF(BTRIM(public.profiles.email), '') IS NULL
      THEN EXCLUDED.email
    ELSE public.profiles.email
  END;

INSERT INTO public.wallets (user_id, balance, history)
SELECT u.id::text, 0, '[]'::jsonb
FROM auth.users AS u
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'customer'
FROM auth.users AS u
ON CONFLICT (user_id, role) DO NOTHING;

COMMIT;
