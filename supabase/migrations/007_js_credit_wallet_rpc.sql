-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Fix GP wallet credit: bypass RLS with SECURITY DEFINER RPC
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Root causes fixed:
--   1. wallet_own_write RLS policy blocks riders/merchants from writing admin wallet
--      JS: supabase.from('wallets').upsert({ user_id: adminUUID }) fails silently
--   2. _wallet_credit tried to INSERT into wallet_transactions table (doesn't exist)
--      causing process_order_settlement RPC to throw on every call
--
-- Fix: js_credit_wallet() runs as SECURITY DEFINER (bypasses RLS),
--      resolves email → UUID inline, and does atomic upsert.
--      Also fix _wallet_credit to not insert into non-existent table.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. js_credit_wallet — called from browser JS (bypasses RLS) ──────────────
CREATE OR REPLACE FUNCTION js_credit_wallet(
  p_user_id TEXT,
  p_amount  NUMERIC,
  p_entry   JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT;
BEGIN
  IF p_user_id IS NULL OR p_amount = 0 THEN RETURN; END IF;

  -- Resolve email to UUID (admin is passed as email from JS constant)
  IF p_user_id LIKE '%@%' THEN
    SELECT id::TEXT INTO v_uid FROM profiles WHERE email = p_user_id LIMIT 1;
    IF v_uid IS NULL THEN v_uid := p_user_id; END IF;
  ELSE
    v_uid := p_user_id;
  END IF;

  INSERT INTO wallets (user_id, balance, history)
  VALUES (v_uid, p_amount, jsonb_build_array(p_entry))
  ON CONFLICT (user_id) DO UPDATE
    SET
      balance = wallets.balance + p_amount,
      history = (jsonb_build_array(p_entry) || COALESCE(wallets.history, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION js_credit_wallet(TEXT, NUMERIC, JSONB) TO authenticated;

-- ── 2. Fix _wallet_credit — remove INSERT into non-existent wallet_transactions ─
CREATE OR REPLACE FUNCTION _wallet_credit(
  p_user_id  TEXT,
  p_amount   NUMERIC,
  p_order_id TEXT,
  p_note     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry JSONB;
  v_uid   TEXT;
BEGIN
  IF p_user_id IS NULL OR p_amount = 0 THEN RETURN; END IF;

  -- Resolve email to UUID
  IF p_user_id LIKE '%@%' THEN
    SELECT id::TEXT INTO v_uid FROM profiles WHERE email = p_user_id LIMIT 1;
    IF v_uid IS NULL THEN v_uid := p_user_id; END IF;
  ELSE
    v_uid := p_user_id;
  END IF;

  v_entry := jsonb_build_object(
    'id',          gen_random_uuid()::text,
    'type',        CASE WHEN p_amount >= 0 THEN 'deposit' ELSE 'withdraw' END,
    'amount',      p_amount,
    'date',        to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
    'desc',        p_note,
    'refOrderId',  p_order_id,
    'createdAtMs', (extract(epoch from now()) * 1000)::bigint
  );

  INSERT INTO wallets (user_id, balance, history)
  VALUES (v_uid, p_amount, jsonb_build_array(v_entry))
  ON CONFLICT (user_id) DO UPDATE
    SET
      balance = wallets.balance + EXCLUDED.balance,
      history = (jsonb_build_array(v_entry) || COALESCE(wallets.history, '[]'::jsonb));
END;
$$;
