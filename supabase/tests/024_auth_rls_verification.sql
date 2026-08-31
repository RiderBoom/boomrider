-- Run as a database owner after migrations 024 and 025.
-- Read-only verification: this file does not change data.

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(required_name, ', ')
  INTO v_missing
  FROM (VALUES
    ('is_admin'),
    ('admin_set_user_role'),
    ('js_credit_wallet'),
    ('create_admin_notification'),
    ('accept_job_offer'),
    ('dispatch_order'),
    ('process_order_settlement'),
    ('append_chat_message'),
    ('respond_job_offer'),
    ('admin_purge_app_data'),
    ('protect_order_security_fields')
  ) AS required(required_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = required_name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing hardened functions: %', v_missing;
  END IF;
END $$;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'user_roles', 'wallets', 'pending_requests',
    'admin_notifs', 'promo_codes', 'app_config', 'restaurants', 'menu_items',
    'riders', 'orders', 'job_offers', 'chats'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', v_table;
    END IF;
  END LOOP;
END $$;

-- These queries should return zero rows. Any result is a deployment blocker.
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_roles'
  AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');

SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'wallets'
  AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');

-- PUBLIC/anon must not execute privileged internals.
SELECT n.nspname, p.proname, p.oid::regprocedure
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE '%\_internal' ESCAPE '\'
  AND (
    EXISTS (
      SELECT 1 FROM aclexplode(p.proacl) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
    OR has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
  );

