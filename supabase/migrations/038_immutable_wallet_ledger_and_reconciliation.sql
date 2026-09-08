BEGIN;

-- Immutable, database-level audit trail for every wallet balance mutation.
-- Existing balances are captured as opening entries; subsequent changes are
-- recorded by a trigger regardless of which RPC initiated the mutation.
CREATE TABLE IF NOT EXISTS public.wallet_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  balance_before NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  entry_type TEXT NOT NULL,
  ref_order_id TEXT,
  note TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_ledger_balance_check
    CHECK (balance_after = balance_before + amount)
);

CREATE INDEX IF NOT EXISTS wallet_ledger_user_created_idx
  ON public.wallet_ledger_entries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_order_idx
  ON public.wallet_ledger_entries (ref_order_id)
  WHERE ref_order_id IS NOT NULL;

ALTER TABLE public.wallet_ledger_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_ledger_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wallet_ledger_entries TO authenticated;

DROP POLICY IF EXISTS wallet_ledger_read_own_or_admin ON public.wallet_ledger_entries;
CREATE POLICY wallet_ledger_read_own_or_admin
  ON public.wallet_ledger_entries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::TEXT OR public.is_admin(auth.uid()));

-- Capture the current balance exactly once so ledger sums remain reconcilable.
INSERT INTO public.wallet_ledger_entries (
  user_id, amount, balance_before, balance_after, entry_type, note
)
SELECT w.user_id, ROUND(COALESCE(w.balance, 0), 2), 0,
       ROUND(COALESCE(w.balance, 0), 2), 'opening_balance',
       'Balance captured when immutable ledger was enabled'
FROM public.wallets w
WHERE NOT EXISTS (
  SELECT 1 FROM public.wallet_ledger_entries l WHERE l.user_id = w.user_id
);

CREATE OR REPLACE FUNCTION public.capture_wallet_ledger_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before NUMERIC(14,2);
  v_after NUMERIC(14,2);
  v_entry JSONB;
BEGIN
  v_before := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE ROUND(COALESCE(OLD.balance, 0), 2) END;
  v_after := ROUND(COALESCE(NEW.balance, 0), 2);

  IF v_after = v_before THEN
    RETURN NEW;
  END IF;

  v_entry := COALESCE(NEW.history->0, '{}'::JSONB);
  INSERT INTO public.wallet_ledger_entries (
    user_id, amount, balance_before, balance_after, entry_type,
    ref_order_id, note, actor_id
  ) VALUES (
    NEW.user_id,
    v_after - v_before,
    v_before,
    v_after,
    COALESCE(NULLIF(v_entry->>'type', ''),
      CASE WHEN v_after >= v_before THEN 'credit' ELSE 'debit' END),
    NULLIF(v_entry->>'refOrderId', ''),
    NULLIF(v_entry->>'desc', ''),
    COALESCE(NULLIF(v_entry->>'actorUserId', ''), auth.uid()::TEXT)
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_wallet_ledger_entry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_wallet_ledger_entry ON public.wallets;
CREATE TRIGGER capture_wallet_ledger_entry
AFTER INSERT OR UPDATE OF balance ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.capture_wallet_ledger_entry();

-- Ledger rows are evidence and may never be edited or deleted, including by an
-- accidental dashboard query. Corrections must be new compensating entries.
CREATE OR REPLACE FUNCTION public.reject_wallet_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger_is_append_only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS protect_wallet_ledger_entries ON public.wallet_ledger_entries;
CREATE TRIGGER protect_wallet_ledger_entries
BEFORE UPDATE OR DELETE ON public.wallet_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.reject_wallet_ledger_mutation();

CREATE OR REPLACE FUNCTION public.get_financial_reconciliation_report()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_access_required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generatedAt', now(),
    'completedWithoutSettlement', (
      SELECT count(*) FROM public.orders
      WHERE COALESCE(data->>'status', status, '') = 'completed'
        AND COALESCE(data->>'settlementStatus', '') <> 'settled'
    ),
    'cancelledWalletWithoutRefund', (
      SELECT count(*) FROM public.orders
      WHERE COALESCE(data->>'status', status, '') = 'cancelled'
        AND COALESCE(data->>'paymentMethod', '') = 'wallet'
        AND COALESCE(data->>'refundStatus', '') <> 'refunded'
    ),
    'completedWithoutRiderIdentity', (
      SELECT count(*) FROM public.orders o
      WHERE COALESCE(o.data->>'status', o.status, '') = 'completed'
        AND COALESCE(NULLIF(o.data->>'riderUserId', ''), (
          SELECT COALESCE(NULLIF(r.user_id, ''), NULLIF(r.data->>'userId', ''))
          FROM public.riders r WHERE r.id = o.data->>'riderId'
        )) IS NULL
    ),
    'negativeWallets', (
      SELECT count(*) FROM public.wallets WHERE balance < 0
    ),
    'walletLedgerVarianceCount', (
      SELECT count(*)
      FROM public.wallets w
      LEFT JOIN (
        SELECT user_id, ROUND(sum(amount), 2) AS ledger_balance
        FROM public.wallet_ledger_entries GROUP BY user_id
      ) l ON l.user_id = w.user_id
      WHERE ROUND(COALESCE(w.balance, 0), 2) <> COALESCE(l.ledger_balance, 0)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_reconciliation_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_reconciliation_report() TO authenticated;

COMMIT;
