-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Fix 1: Atomic chat append  |  Fix 2: Safe wallet history clear
-- Run in Supabase SQL Editor after 003_fix_wallets_and_settlement.sql
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Ensure chats table exists with correct shape ──────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
  order_id   TEXT        PRIMARY KEY,
  messages   JSONB       NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- FIX 1: Atomic chat message append
-- Replaces the JS read-then-write (upsert) that drops concurrent messages.
-- ON CONFLICT appends the new message to whatever is currently in the DB row,
-- so two simultaneous sends produce [msgA, msgB] — neither is lost.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION append_chat_message(
  p_order_id TEXT,
  p_message  JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO chats (order_id, messages, updated_at)
  VALUES (p_order_id, jsonb_build_array(p_message), now())
  ON CONFLICT (order_id) DO UPDATE
    SET messages   = chats.messages || jsonb_build_array(p_message),
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION append_chat_message(TEXT, JSONB) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- FIX 2: Safe wallet history clear
-- Runs as SECURITY DEFINER (server-side lock → no read-before-write race).
-- Only the wallet owner or admin can call this.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION clear_wallet_history(p_user_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    TEXT;
  v_caller_email TEXT;
BEGIN
  v_caller_id := auth.uid()::text;
  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();

  -- Allow: own wallet, admin email, or service_role
  IF v_caller_id IS DISTINCT FROM p_user_id
     AND v_caller_email IS DISTINCT FROM 'boomzalnw2@gmail.com'
     AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Permission denied: only admin or wallet owner can clear history';
  END IF;

  UPDATE wallets SET history = '[]'::jsonb WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_wallet_history(TEXT) TO authenticated;
