-- ══════════════════════════════════════════════════════════════════════════════
-- BoomRider — Grab Core Dispatch Engine Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Prerequisites ─────────────────────────────────────────────────────────────
-- Enable earthdistance for radius calculations (available on all Supabase plans)
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1: Rider GPS + Availability Columns
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS current_lat      FLOAT,
  ADD COLUMN IF NOT EXISTS current_lng      FLOAT,
  ADD COLUMN IF NOT EXISTS is_available     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;

-- Fast geo-filter index (only scans available riders)
CREATE INDEX IF NOT EXISTS idx_riders_available_geo
  ON riders (is_available, current_lat, current_lng)
  WHERE is_available = true;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2: Job Offers Queue (Grab-style exclusive dispatch)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS job_offers (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       TEXT         NOT NULL,
  rider_id       TEXT         NOT NULL,       -- riders.id
  rider_user_id  TEXT         NOT NULL,       -- auth UID → Realtime filter
  status         TEXT         NOT NULL DEFAULT 'pending',
    -- pending | accepted | rejected | timeout | cancelled
  attempt_no     SMALLINT     NOT NULL DEFAULT 1,
  offered_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ  NOT NULL DEFAULT (now() + INTERVAL '25 seconds'),
  responded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_offers_rider   ON job_offers (rider_user_id, status);
CREATE INDEX IF NOT EXISTS idx_job_offers_order   ON job_offers (order_id, status);
CREATE INDEX IF NOT EXISTS idx_job_offers_expires ON job_offers (expires_at) WHERE status = 'pending';

-- Enable Realtime for rider push (INSERT fires Supabase Realtime event)
ALTER PUBLICATION supabase_realtime ADD TABLE job_offers;

-- RLS: riders see only their own offers; service_role does everything
ALTER TABLE job_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rider_view_own_offers" ON job_offers;
CREATE POLICY "rider_view_own_offers" ON job_offers
  FOR SELECT USING (rider_user_id = auth.uid()::text);

DROP POLICY IF EXISTS "rider_update_own_offers" ON job_offers;
CREATE POLICY "rider_update_own_offers" ON job_offers
  FOR UPDATE USING (rider_user_id = auth.uid()::text);

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3: Auto-Dispatch RPC — "Smart Brain" (ค้นหา + ยิงข้อเสนอ)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION dispatch_order(
  p_order_id   TEXT,
  p_pickup_lat FLOAT,
  p_pickup_lng FLOAT,
  p_radius_km  FLOAT DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider    RECORD;
  v_attempt  INT;
  v_offer_id UUID;
BEGIN
  -- Idempotency: skip if a live pending offer already exists for this order
  IF EXISTS (
    SELECT 1 FROM job_offers
    WHERE order_id = p_order_id
      AND status = 'pending'
      AND expires_at > now()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_already_pending');
  END IF;

  -- Skip if order already has an accepted rider
  IF EXISTS (
    SELECT 1 FROM job_offers
    WHERE order_id = p_order_id AND status = 'accepted'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_accepted');
  END IF;

  -- Determine attempt number (recursive loop counter)
  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_attempt
  FROM job_offers WHERE order_id = p_order_id;

  -- ── Find nearest available rider not yet offered this order ──────────────
  SELECT
    r.id                      AS rider_id,
    r.data->>'userId'         AS rider_user_id,
    earth_distance(
      ll_to_earth(r.current_lat, r.current_lng),
      ll_to_earth(p_pickup_lat, p_pickup_lng)
    ) / 1000.0                AS dist_km
  INTO v_rider
  FROM riders r
  WHERE r.is_available = true
    AND r.current_lat  IS NOT NULL
    AND r.current_lng  IS NOT NULL
    -- Exclude riders who already received an offer (any status) for this order
    AND NOT EXISTS (
      SELECT 1 FROM job_offers jo
      WHERE jo.order_id  = p_order_id
        AND jo.rider_id  = r.id
    )
    -- Within configured radius
    AND earth_distance(
          ll_to_earth(r.current_lat, r.current_lng),
          ll_to_earth(p_pickup_lat, p_pickup_lng)
        ) / 1000.0 <= p_radius_km
  ORDER BY dist_km ASC
  LIMIT 1;

  -- ── No riders available ─────────────────────────────────────────────────
  IF v_rider IS NULL THEN
    UPDATE orders
    SET data = data || '{"dispatchStatus":"no_rider_available"}'::jsonb
    WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'ok',      false,
      'reason',  'no_rider_available',
      'attempt', v_attempt
    );
  END IF;

  -- ── Insert job offer — Realtime broadcasts INSERT to that rider ─────────
  INSERT INTO job_offers (order_id, rider_id, rider_user_id, attempt_no)
  VALUES (p_order_id, v_rider.rider_id, v_rider.rider_user_id, v_attempt)
  RETURNING id INTO v_offer_id;

  RETURN jsonb_build_object(
    'ok',       true,
    'offer_id', v_offer_id,
    'rider_id', v_rider.rider_id,
    'attempt',  v_attempt,
    'dist_km',  round(v_rider.dist_km::numeric, 2)
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4: Timeout Cleanup — Re-dispatch expired offers (called by Edge Function)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_expired_offers()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec   RECORD;
  v_data  JSONB;
  v_count INT := 0;
BEGIN
  FOR v_rec IN
    UPDATE job_offers
    SET status = 'timeout', responded_at = now()
    WHERE status = 'pending' AND expires_at < now()
    RETURNING order_id
  LOOP
    -- Re-dispatch only if order is still waiting for a rider
    SELECT data INTO v_data FROM orders WHERE id = v_rec.order_id;
    IF v_data->>'status' IN ('pending', 'ready_to_pickup') THEN
      PERFORM dispatch_order(
        v_rec.order_id,
        (v_data->'pickupLocation'->>'lat')::FLOAT,
        (v_data->'pickupLocation'->>'lng')::FLOAT
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 5: Wallet Transactions Audit Table
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT         NOT NULL,
  amount       NUMERIC      NOT NULL,
  type         TEXT         NOT NULL,   -- credit | debit
  ref_order_id TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions (user_id, created_at DESC);

-- RLS: users see only their own transactions
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_transactions" ON wallet_transactions;
CREATE POLICY "own_transactions" ON wallet_transactions
  FOR SELECT USING (user_id = auth.uid()::text);

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 6: Settlement RPC — Dual-Path (Wallet / Cash) with Race-Condition Lock
-- ══════════════════════════════════════════════════════════════════════════════

-- Atomic helper: upsert wallet + log transaction
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
BEGIN
  IF p_user_id IS NULL OR p_amount = 0 THEN RETURN; END IF;

  -- Upsert wallet (creates row if user has never used wallet)
  INSERT INTO wallets (user_id, balance)
  VALUES (p_user_id, p_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = wallets.balance + EXCLUDED.balance;

  -- Audit trail
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

-- ── Main Settlement RPC ───────────────────────────────────────────────────────
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
  v_gp_rate   NUMERIC := 0.10;    -- 10% GP; change per appConfig
  v_gp        NUMERIC;
  v_merch_inc NUMERIC;
  v_rider_uid TEXT;
  v_merch_uid TEXT;
  v_admin_uid TEXT := 'boomzalnw2@gmail.com';  -- Admin wallet key
BEGIN
  -- ── Row-level lock — prevents double-settlement (NOWAIT = fail fast) ────
  SELECT data INTO v_order
  FROM orders WHERE id = p_order_id
  FOR UPDATE NOWAIT;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- ── Idempotency guard ───────────────────────────────────────────────────
  IF v_order->>'settlementStatus' = 'settled' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_settled');
  END IF;

  -- ── Extract order fields ────────────────────────────────────────────────
  v_method    := v_order->>'paymentMethod';
  v_food      := COALESCE((v_order->>'foodTotal')::NUMERIC,    0);
  v_deliv     := COALESCE((v_order->>'deliveryFee')::NUMERIC,  0);
  v_gp        := ROUND(v_food * v_gp_rate, 2);
  v_merch_inc := ROUND(v_food - v_gp, 2);
  -- These fields are written by placeOrder + acceptOrder (see useOrderActions.js)
  v_rider_uid := v_order->>'riderUserId';
  v_merch_uid := v_order->>'restaurantOwnerId';

  -- ════════════════════════════════════════════════════════════════════════
  -- WALLET PATH: Customer already paid grandTotal at order time.
  -- Distribute: merchant ← food*(1−GP), rider ← deliveryFee, admin ← GP
  -- ════════════════════════════════════════════════════════════════════════
  IF v_method = 'wallet' THEN
    PERFORM _wallet_credit(v_merch_uid, v_merch_inc, p_order_id, 'รายได้ร้านค้า');
    PERFORM _wallet_credit(v_rider_uid, v_deliv,     p_order_id, 'ค่าส่ง');
    PERFORM _wallet_credit(v_admin_uid, v_gp,        p_order_id, 'GP platform');

  -- ════════════════════════════════════════════════════════════════════════
  -- CASH PATH: Rider collected (food + delivery) cash from customer.
  -- Rider keeps delivery fee.
  -- Rider owes food_total to system → debit rider wallet.
  -- Merchant gets digital credit (to withdraw from admin later).
  -- ════════════════════════════════════════════════════════════════════════
  ELSIF v_method = 'cash' THEN
    PERFORM _wallet_credit(v_rider_uid, -v_food,     p_order_id, 'หักยอดร้าน(สด)');
    PERFORM _wallet_credit(v_merch_uid,  v_merch_inc, p_order_id, 'รายได้ร้านค้า(สด)');
    PERFORM _wallet_credit(v_admin_uid,  v_gp,        p_order_id, 'GP(สด)');
  END IF;

  -- ── Mark settled + completed ────────────────────────────────────────────
  UPDATE orders
  SET
    status = 'completed',
    data   = data || jsonb_build_object(
      'status',           'completed',
      'settlementStatus', 'settled',
      'completedAt',      to_char(now(), 'DD/MM/YYYY HH24:MI'),
      'settlement', jsonb_build_object(
        'method',         v_method,
        'foodTotal',      v_food,
        'deliveryFee',    v_deliv,
        'gpAmount',       v_gp,
        'merchantIncome', v_merch_inc
      )
    )
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'method',       v_method,
    'merchantIncome', v_merch_inc,
    'riderIncome',  v_deliv,
    'gpAmount',     v_gp
  );

EXCEPTION
  WHEN lock_not_available THEN
    -- Another concurrent call is already settling — safe to ignore
    RETURN jsonb_build_object('ok', false, 'error', 'concurrent_settlement_in_progress');
END;
$$;

-- Grant execution rights to frontend via supabase.rpc()
GRANT EXECUTE ON FUNCTION dispatch_order(TEXT, FLOAT, FLOAT, FLOAT) TO authenticated;
GRANT EXECUTE ON FUNCTION process_order_settlement(TEXT)            TO authenticated;
GRANT EXECUTE ON FUNCTION process_expired_offers()                  TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 7: Auto-complete trigger (optional)
-- If customer doesn't confirm within 15 minutes, auto-settle.
-- Uncomment and schedule via pg_cron or Supabase Edge Function cron.
-- ══════════════════════════════════════════════════════════════════════════════
/*
CREATE OR REPLACE FUNCTION auto_complete_delivered_orders()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_rec RECORD; v_count INT := 0;
BEGIN
  FOR v_rec IN
    SELECT id FROM orders
    WHERE status = 'delivered'
      AND (data->>'deliveredAt')::TIMESTAMPTZ < now() - INTERVAL '15 minutes'
      AND data->>'settlementStatus' IS DISTINCT FROM 'settled'
  LOOP
    PERFORM process_order_settlement(v_rec.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
-- SELECT cron.schedule('auto-complete', '5 minutes', 'SELECT auto_complete_delivered_orders()');
*/
