-- Run as database owner after migration 027. Read-only verification.

DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(name, ', ') INTO v_missing
  FROM (VALUES ('push_devices'), ('notification_deliveries')) required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = required.name AND c.relrowsecurity
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing push tables or RLS: %', v_missing;
  END IF;
END $$;

DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(name, ', ') INTO v_missing
  FROM (VALUES ('register_push_device'), ('disable_push_device')) required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = required.name
  );
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'Missing push RPCs: %', v_missing; END IF;
END $$;

-- Must return zero rows: clients may not read the delivery ledger.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'notification_deliveries'
  AND grantee IN ('anon', 'authenticated');

-- Only own-device SELECT/DELETE policies should be exposed to authenticated users.
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'push_devices'
ORDER BY policyname;
