-- ══════════════════════════════════════════════════════════════════════════════
-- 030_security_and_wallet_atomicity.sql
-- 1. Hardens internal SECURITY DEFINER RPC permissions (Revoke PUBLIC access)
-- 2. Atomic customer order placement with server-side wallet balance deduction
-- 3. Atomic admin pending request approval procedure with FOR UPDATE locking
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. REVOKE PUBLIC Access on Internal SECURITY DEFINER RPCs ─────────────────

-- Revoke execute on _wallet_credit overloads
DO $$
BEGIN
  IF to_regprocedure('public._wallet_credit(text,numeric,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public._wallet_credit(text,numeric,text,text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public._wallet_credit(text,numeric,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public._wallet_credit(text,numeric,jsonb) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- Revoke execute on accept_order_direct_internal
DO $$
BEGIN
  IF to_regprocedure('public.accept_order_direct_internal(text,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.accept_order_direct_internal(text,text,text) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- Revoke execute on accept_job_offer_internal
DO $$
BEGIN
  IF to_regprocedure('public.accept_job_offer_internal(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.accept_job_offer_internal(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;


-- ── 2. Atomic Customer Order Placement RPC ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.place_customer_order(p_order JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id TEXT;
  v_cust_uid TEXT;
  v_method TEXT;
  v_total NUMERIC := 0;
  v_status TEXT;
  v_wallet RECORD;
  v_bal NUMERIC := 0;
  v_entry JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  v_order_id := p_order->>'id';
  v_cust_uid := COALESCE(p_order->>'customerId', p_order->>'userId');
  v_method   := COALESCE(p_order->>'paymentMethod', 'cash');
  v_total    := COALESCE((p_order->>'grandTotal')::NUMERIC, 0);
  v_status   := COALESCE(p_order->>'status', 'pending');

  IF v_order_id IS NULL OR v_order_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_order_id');
  END IF;

  -- Verify auth ownership
  IF v_cust_uid IS DISTINCT FROM auth.uid()::text AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'order_placement_access_denied' USING ERRCODE = '42501';
  END IF;

  -- Handle atomic wallet deduction if paymentMethod = 'wallet'
  IF v_method = 'wallet' AND v_total > 0 THEN
    -- Ensure wallet row exists
    INSERT INTO public.wallets (user_id, balance, history)
    VALUES (v_cust_uid, 0, '[]'::jsonb)
    ON CONFLICT (user_id) DO NOTHING;

    -- Lock wallet row FOR UPDATE
    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE user_id = v_cust_uid
    FOR UPDATE;

    v_bal := COALESCE(v_wallet.balance, 0);

    IF v_bal < v_total THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_CUSTOMER_WALLET',
        'requiredBalance', v_total,
        'currentBalance', v_bal
      );
    END IF;

    v_entry := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'withdraw',
      'amount', -v_total,
      'date', to_char(now() AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS'),
      'desc', 'ชำระค่าสินค้า/บริการ ออเดอร์ #' || right(v_order_id, 6),
      'refOrderId', v_order_id,
      'createdAtMs', (extract(epoch FROM now()) * 1000)::bigint,
      'actorUserId', auth.uid()::text
    );

    UPDATE public.wallets
    SET balance = balance - v_total,
        history = jsonb_build_array(v_entry) || COALESCE(history, '[]'::jsonb)
    WHERE user_id = v_cust_uid;
  END IF;

  -- Insert order into orders table
  INSERT INTO public.orders (id, status, data)
  VALUES (v_order_id, v_status, p_order);

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.place_customer_order(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_customer_order(JSONB) TO authenticated;


-- ── 3. Atomic Admin Pending Request Approval RPC ──────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_pending_request(p_request_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
  v_req_data JSONB;
  v_req_type TEXT;
  v_user_id TEXT;
  v_amt NUMERIC;
  v_wallet RECORD;
  v_bal NUMERIC := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  -- Lock request FOR UPDATE
  SELECT * INTO v_req
  FROM public.pending_requests
  WHERE id = p_request_id
  FOR UPDATE NOWAIT;

  IF v_req IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
  END IF;

  v_req_data := v_req.data;
  v_req_type := COALESCE(v_req.type, v_req_data->>'type');
  v_user_id  := COALESCE(v_req.user_id, v_req_data->>'userId');

  IF v_req_type = 'topup' THEN
    v_amt := COALESCE((v_req_data->'data'->>'amount')::NUMERIC, (v_req_data->>'amount')::NUMERIC, 0);
    IF v_amt <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_topup_amount');
    END IF;

    PERFORM public._wallet_credit(
      v_user_id, v_amt, NULL,
      'เติมเงิน ฿' || trim(to_char(v_amt, '999,999,990.00')) || ' (Admin อนุมัติ)'
    );

  ELSIF v_req_type = 'withdraw' THEN
    v_amt := COALESCE((v_req_data->'data'->>'amount')::NUMERIC, (v_req_data->>'amount')::NUMERIC, 0);
    IF v_amt <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_withdraw_amount');
    END IF;

    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE user_id = v_user_id
    FOR UPDATE;

    v_bal := COALESCE(v_wallet.balance, 0);
    IF v_bal < v_amt THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'INSUFFICIENT_WALLET_BALANCE',
        'currentBalance', v_bal,
        'requestedAmount', v_amt
      );
    END IF;

    PERFORM public._wallet_credit(
      v_user_id, -v_amt, NULL,
      'ถอนเงิน ฿' || trim(to_char(v_amt, '999,999,990.00')) || ' (Admin อนุมัติ)'
    );
  END IF;

  -- Remove processed request
  DELETE FROM public.pending_requests WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id, 'type', v_req_type);

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'concurrent_approval_in_progress');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pending_request(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pending_request(TEXT) TO authenticated;

COMMIT;
