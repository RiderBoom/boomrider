-- Run after migrations in an isolated Supabase environment.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.wallet_ledger_entries') IS NULL THEN
    RAISE EXCEPTION 'wallet_ledger_entries is missing';
  END IF;
  IF to_regprocedure('public.get_financial_reconciliation_report()') IS NULL THEN
    RAISE EXCEPTION 'reconciliation RPC is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'capture_wallet_ledger_entry' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'wallet ledger capture trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'protect_wallet_ledger_entries' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'wallet ledger protection trigger is missing';
  END IF;
END;
$$;

ROLLBACK;
