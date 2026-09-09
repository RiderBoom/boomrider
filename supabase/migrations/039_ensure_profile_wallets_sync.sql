-- Migration 039: Ensure Profile-Wallet Synchronization and Auto Backfill
-- Ensures 1:1 correspondence between profiles and wallets table records.

BEGIN;

-- 1. Backfill wallets table for any existing profiles missing a wallet record
INSERT INTO public.wallets (user_id, balance, history)
SELECT id::text, 0, '[]'::jsonb
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- 2. Ensure admin_purge_app_data re-initializes wallets for all registered profiles when wallets are purged
CREATE OR REPLACE FUNCTION public.admin_purge_app_data(p_scope text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  CASE p_scope
    WHEN 'orders' THEN
      DELETE FROM public.orders;
    WHEN 'pending_requests' THEN
      DELETE FROM public.pending_requests;
    WHEN 'restaurants' THEN
      DELETE FROM public.restaurants;
    WHEN 'riders' THEN
      DELETE FROM public.riders;
    WHEN 'wallets' THEN
      DELETE FROM public.wallets;
      -- Re-initialize 0-balance wallets for all remaining profiles
      INSERT INTO public.wallets (user_id, balance, history)
      SELECT id::text, 0, '[]'::jsonb
      FROM public.profiles
      ON CONFLICT (user_id) DO NOTHING;
    WHEN 'wallet_history' THEN
      UPDATE public.wallets SET history = '[]'::jsonb;
    ELSE
      RAISE EXCEPTION 'invalid_purge_scope' USING ERRCODE = '22023';
  END CASE;
END;
$$;

COMMIT;
