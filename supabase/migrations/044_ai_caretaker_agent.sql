-- Migration 044: BoomBot AI Caretaker Agent Tables & Repair RPCs

-- ── 1. AI Agent Logs Table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_agent_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_source      TEXT NOT NULL DEFAULT 'cron_scheduled',
  health_status       TEXT NOT NULL DEFAULT 'healthy',
  reasoning_thought   TEXT,
  action_taken        TEXT,
  execution_result    JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.ai_agent_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_agent_logs_admin_all" ON public.ai_agent_logs;
CREATE POLICY "ai_agent_logs_admin_all" ON public.ai_agent_logs
  FOR ALL
  USING (
    auth.role() = 'service_role' OR
    (SELECT current_setting('role', true)) = 'service_role' OR
    public.is_admin((SELECT auth.uid()))
  );

-- ── 2. AI Suggested Actions Table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_suggested_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              TEXT NOT NULL DEFAULT 'pending',
  action_type         TEXT NOT NULL,
  target_id           TEXT,
  title               TEXT NOT NULL,
  reasoning           TEXT,
  payload             JSONB DEFAULT '{}'::jsonb,
  executed_at         TIMESTAMPTZ,
  executed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.ai_suggested_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_suggested_actions_admin_all" ON public.ai_suggested_actions;
CREATE POLICY "ai_suggested_actions_admin_all" ON public.ai_suggested_actions
  FOR ALL
  USING (
    auth.role() = 'service_role' OR
    (SELECT current_setting('role', true)) = 'service_role' OR
    public.is_admin((SELECT auth.uid()))
  );

-- Enable Realtime for AI Agent tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_agent_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_suggested_actions;

-- ── 3. Helper Authorization Checker ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin_or_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.role() = 'service_role')
      OR ((SELECT current_setting('role', true)) = 'service_role')
      OR public.is_admin((SELECT auth.uid()));
$$;

REVOKE ALL ON FUNCTION public.is_admin_or_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_service_role() TO authenticated, service_role;

-- ── 4. Admin System Health Diagnostic RPC (Service Role Allowed) ─────────────
CREATE OR REPLACE FUNCTION public.admin_get_system_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized boolean;
  v_result jsonb;
BEGIN
  v_authorized := public.is_admin_or_service_role();
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  WITH order_health AS (
    SELECT
      count(*) AS total_orders,
      count(*) FILTER (WHERE COALESCE(data->>'status', status, '') = 'completed') AS completed_orders,
      count(*) FILTER (WHERE COALESCE(data->>'status', status, '') = 'cancelled') AS cancelled_orders,
      count(*) FILTER (
        WHERE COALESCE(data->>'status', status, '') = 'completed'
          AND COALESCE(data->>'settlementStatus', '') <> 'settled'
      ) AS completed_unsettled_count,
      count(*) FILTER (
        WHERE COALESCE(data->>'status', status, '') = 'cancelled'
          AND COALESCE(data->>'paymentMethod', '') = 'wallet'
          AND COALESCE(data->>'refundStatus', '') <> 'refunded'
      ) AS cancelled_unrefunded_count
    FROM public.orders
  ),
  wallet_health AS (
    SELECT
      count(*) AS total_wallets,
      count(*) FILTER (WHERE balance < 0) AS negative_wallets_count,
      ROUND(COALESCE(sum(balance), 0), 2) AS total_wallet_balance_sum
    FROM public.wallets
  ),
  ledger_health AS (
    SELECT
      count(*) AS total_ledger_entries,
      ROUND(COALESCE(sum(amount), 0), 2) AS total_ledger_amount_sum
    FROM public.wallet_ledger_entries
  ),
  variance_health AS (
    SELECT
      count(*) AS wallet_ledger_variance_count
    FROM public.wallets w
    LEFT JOIN (
      SELECT user_id, ROUND(sum(amount), 2) AS ledger_balance
      FROM public.wallet_ledger_entries
      GROUP BY user_id
    ) l ON l.user_id = w.user_id
    WHERE ROUND(COALESCE(w.balance, 0), 2) <> COALESCE(l.ledger_balance, 0)
  ),
  entity_counts AS (
    SELECT
      (SELECT count(*) FROM public.profiles) AS total_profiles,
      (SELECT count(*) FROM public.user_roles) AS total_user_roles,
      (SELECT count(*) FROM public.restaurants) AS total_restaurants,
      (SELECT count(*) FROM public.riders) AS total_riders,
      (SELECT count(*) FROM public.pending_requests) AS total_pending_requests,
      (SELECT count(*) FROM public.service_quotes) AS total_service_quotes
    FROM (SELECT 1) AS dummy
  )
  SELECT jsonb_build_object(
    'timestamp', now(),
    'system_status', CASE
      WHEN o.completed_unsettled_count = 0
       AND o.cancelled_unrefunded_count = 0
       AND w.negative_wallets_count = 0
       AND v.wallet_ledger_variance_count = 0
      THEN 'healthy'
      ELSE 'warning_detected'
    END,
    'order_health', jsonb_build_object(
      'total_orders', o.total_orders,
      'completed_orders', o.completed_orders,
      'cancelled_orders', o.cancelled_orders,
      'completed_unsettled_count', o.completed_unsettled_count,
      'cancelled_unrefunded_count', o.cancelled_unrefunded_count
    ),
    'wallet_health', jsonb_build_object(
      'total_wallets', w.total_wallets,
      'negative_wallets_count', w.negative_wallets_count,
      'total_wallet_balance_sum', w.total_wallet_balance_sum
    ),
    'ledger_health', jsonb_build_object(
      'total_ledger_entries', l.total_ledger_entries,
      'total_ledger_amount_sum', l.total_ledger_amount_sum
    ),
    'variance_health', jsonb_build_object(
      'wallet_ledger_variance_count', v.wallet_ledger_variance_count
    ),
    'entity_counts', jsonb_build_object(
      'total_profiles', e.total_profiles,
      'total_user_roles', e.total_user_roles,
      'total_restaurants', e.total_restaurants,
      'total_riders', e.total_riders,
      'total_pending_requests', e.total_pending_requests,
      'total_service_quotes', e.total_service_quotes
    )
  ) INTO v_result
  FROM order_health o, wallet_health w, ledger_health l, variance_health v, entity_counts e;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_system_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_system_health() TO authenticated, service_role;

-- ── 5. Caretaker RPC: Reconcile Wallet Ledger ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reconcile_wallet_ledger(p_target_user_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized BOOLEAN;
  v_rec RECORD;
  v_reconciled_count INT := 0;
  v_details JSONB := '[]'::jsonb;
  v_ledger_sum NUMERIC;
  v_wallet_bal NUMERIC;
BEGIN
  v_authorized := public.is_admin_or_service_role();
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT w.user_id, w.balance
    FROM public.wallets w
    WHERE p_target_user_id IS NULL OR w.user_id = p_target_user_id
  LOOP
    SELECT ROUND(COALESCE(SUM(amount), 0), 2)
    INTO v_ledger_sum
    FROM public.wallet_ledger_entries
    WHERE user_id = v_rec.user_id;

    v_wallet_bal := ROUND(COALESCE(v_rec.balance, 0), 2);

    IF v_wallet_bal <> v_ledger_sum THEN
      UPDATE public.wallets
      SET balance = v_ledger_sum
      WHERE user_id = v_rec.user_id;

      v_reconciled_count := v_reconciled_count + 1;
      v_details := v_details || jsonb_build_object(
        'user_id', v_rec.user_id,
        'old_balance', v_wallet_bal,
        'new_balance', v_ledger_sum,
        'difference', ROUND(v_ledger_sum - v_wallet_bal, 2)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reconciled_count', v_reconciled_count, 'details', v_details);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_wallet_ledger(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_wallet_ledger(TEXT) TO authenticated, service_role;

-- ── 6. Caretaker RPC: Retry Stuck Order Settlement ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_retry_stuck_order_settlement(p_target_order_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized BOOLEAN;
  v_rec RECORD;
  v_settled_count INT := 0;
  v_failed_count INT := 0;
  v_settled_ids JSONB := '[]'::jsonb;
  v_res JSONB;
BEGIN
  v_authorized := public.is_admin_or_service_role();
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT id
    FROM public.orders
    WHERE COALESCE(data->>'status', status, '') = 'completed'
      AND COALESCE(data->>'settlementStatus', '') <> 'settled'
      AND (p_target_order_id IS NULL OR id = p_target_order_id)
  LOOP
    BEGIN
      v_res := public.process_order_settlement(v_rec.id);
      IF COALESCE((v_res->>'ok')::boolean, false) THEN
        v_settled_count := v_settled_count + 1;
        v_settled_ids := v_settled_ids || jsonb_build_object('order_id', v_rec.id, 'status', 'settled');
      ELSE
        v_failed_count := v_failed_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed_count := v_failed_count + 1;
    END BEGIN;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'settled_count', v_settled_count, 'failed_count', v_failed_count, 'details', v_settled_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retry_stuck_order_settlement(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_stuck_order_settlement(TEXT) TO authenticated, service_role;

-- ── 7. Caretaker RPC: Execute AI Suggested Action ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_execute_ai_suggested_action(p_action_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized BOOLEAN;
  v_action RECORD;
  v_result JSONB;
BEGIN
  v_authorized := public.is_admin_or_service_role();
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_action
  FROM public.ai_suggested_actions
  WHERE id = p_action_id
  FOR UPDATE;

  IF v_action.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_not_found');
  END IF;

  IF v_action.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_already_processed', 'status', v_action.status);
  END IF;

  IF v_action.action_type = 'reconcile_wallet' OR v_action.action_type = 'audit_negative_wallets' THEN
    v_result := public.admin_reconcile_wallet_ledger(v_action.target_id);
  ELSIF v_action.action_type = 'settle_stuck_order' THEN
    v_result := public.admin_retry_stuck_order_settlement(v_action.target_id);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_action_type');
  END IF;

  UPDATE public.ai_suggested_actions
  SET status = 'executed',
      executed_at = NOW(),
      executed_by = (SELECT auth.uid())
  WHERE id = p_action_id;

  RETURN jsonb_build_object('ok', true, 'action_id', p_action_id, 'action_type', v_action.action_type, 'execution_result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_execute_ai_suggested_action(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_execute_ai_suggested_action(UUID) TO authenticated, service_role;
