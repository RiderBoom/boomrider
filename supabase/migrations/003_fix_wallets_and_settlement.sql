-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Fix Wallet History + Settlement Consistency
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Ensure wallets table has history JSONB column ─────────────────────────
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]';

-- ── 2. Ensure wallets has a unique constraint on user_id ─────────────────────
-- (Required for ON CONFLICT upsert — safe if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wallets'::regclass
      AND contype = 'u'
      AND conname = 'wallets_user_id_key'
  ) THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- ── 3. Fix _wallet_credit: update balance AND prepend to history ──────────────
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
BEGIN
  IF p_user_id IS NULL OR p_amount = 0 THEN RETURN; END IF;

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
  VALUES (p_user_id, p_amount, jsonb_build_array(v_entry))
  ON CONFLICT (user_id) DO UPDATE
    SET
      balance = wallets.balance + EXCLUDED.balance,
      history = (jsonb_build_array(v_entry) || COALESCE(wallets.history, '[]'::jsonb));

  INSERT INTO wallet_transactions (user_id, amount, type, ref_order_id, note)
  VALUES (
    p_user_id,
    p_amount,
    CASE WHEN p_amount >= 0 THEN 'credit' ELSE 'debit' END,
    p_order_id,
    p_note
  );
END;
$$;

-- ── 4. Fix process_order_settlement ──────────────────────────────────────────
--   a) Look up merchantOwnerId from restaurants table if missing in order data
--   b) For cash: also credit rider delivery fee (consistent with JS fallback)
--   c) Return riderIncome accurately
CREATE OR REPLACE FUNCTION process_order_settlement(p_order_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order     JSONB;
  v_method    TEXT;
  v_food      NUMERIC;
  v_deliv     NUMERIC;
  v_gp_rate   NUMERIC := 0.10;
  v_gp        NUMERIC;
  v_merch_inc NUMERIC;
  v_rider_uid TEXT;
  v_merch_uid TEXT;
  v_admin_uid TEXT := 'boomzalnw2@gmail.com';
BEGIN
  SELECT data INTO v_order
  FROM orders WHERE id = p_order_id
  FOR UPDATE NOWAIT;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  IF v_order->>'settlementStatus' = 'settled' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_settled');
  END IF;

  v_method    := v_order->>'paymentMethod';
  v_food      := COALESCE((v_order->>'foodTotal')::NUMERIC,   0);
  v_deliv     := COALESCE((v_order->>'deliveryFee')::NUMERIC, 0);
  v_gp        := ROUND(v_food * v_gp_rate, 2);
  v_merch_inc := ROUND(v_food - v_gp, 2);
  v_rider_uid := v_order->>'riderUserId';
  v_merch_uid := v_order->>'restaurantOwnerId';

  -- Fallback: look up merchant from restaurants table if not stamped on order
  IF v_merch_uid IS NULL THEN
    SELECT data->>'ownerId' INTO v_merch_uid
    FROM restaurants WHERE id = v_order->>'restaurantId';
  END IF;

  IF v_method = 'wallet' THEN
    PERFORM _wallet_credit(v_merch_uid, v_merch_inc, p_order_id, 'รายได้ร้านค้า');
    PERFORM _wallet_credit(v_rider_uid, v_deliv,     p_order_id, 'ค่าส่ง');
    PERFORM _wallet_credit(v_admin_uid, v_gp,        p_order_id, 'GP platform');

  ELSIF v_method = 'cash' THEN
    -- Rider collected cash: debit food (must remit to system), credit delivery fee (theirs to keep)
    PERFORM _wallet_credit(v_rider_uid, -v_food,      p_order_id, 'หักยอดร้าน(สด)');
    PERFORM _wallet_credit(v_rider_uid,  v_deliv,     p_order_id, 'ค่าส่ง(สด)');
    PERFORM _wallet_credit(v_merch_uid,  v_merch_inc, p_order_id, 'รายได้ร้านค้า(สด)');
    PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP(สด)');
  END IF;

  UPDATE orders
  SET
    status = 'completed',
    data   = data || jsonb_build_object(
      'status',           'completed',
      'settlementStatus', 'settled',
      'completedAt',      to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
      'settlement', jsonb_build_object(
        'method',         v_method,
        'foodTotal',      v_food,
        'deliveryFee',    v_deliv,
        'gpAmount',       v_gp,
        'merchantIncome', v_merch_inc,
        'riderIncome',    v_deliv
      )
    )
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'method',         v_method,
    'merchantIncome', v_merch_inc,
    'riderIncome',    v_deliv,
    'gpAmount',       v_gp
  );

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'error', 'concurrent_settlement_in_progress');
END;
$$;

-- ── 5. Ensure RLS allows authenticated users to read/write their own wallet ───
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_own_read"  ON wallets;
DROP POLICY IF EXISTS "wallet_own_write" ON wallets;

CREATE POLICY "wallet_own_read" ON wallets
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "wallet_own_write" ON wallets
  FOR ALL USING (user_id = auth.uid()::text);

-- ── 6. Grants ─────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION process_order_settlement(TEXT) TO authenticated;
