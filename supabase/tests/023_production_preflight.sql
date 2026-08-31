-- Read-only preflight. Run before any production migration and save the output.
-- This script intentionally performs no INSERT/UPDATE/DELETE/DDL.

SELECT current_database() AS database_name, now() AS checked_at;

SELECT c.relname AS table_name,
       c.reltuples::bigint AS estimated_rows,
       c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relname IN (
    'profiles','user_roles','wallets','orders','restaurants','menu_items',
    'riders','pending_requests','chats','promo_codes','admin_notifs',
    'app_config','job_offers','wallet_transactions'
  )
ORDER BY c.relname;

SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename, policyname;

SELECT role, count(*) AS assignments
FROM public.user_roles
GROUP BY role
ORDER BY role;

SELECT count(*) FILTER (WHERE role='admin') AS admin_count
FROM public.user_roles;

SELECT count(*) AS restaurants_missing_owner
FROM public.restaurants
WHERE owner_id IS NULL OR btrim(owner_id)='';

SELECT count(*) AS riders_missing_owner
FROM public.riders
WHERE COALESCE(NULLIF(user_id,''), NULLIF(data->>'userId','')) IS NULL;

SELECT count(*) AS orders_missing_customer
FROM public.orders
WHERE COALESCE(NULLIF(data->>'customerId',''), NULLIF(data->>'userId','')) IS NULL;

SELECT count(*) AS wallets_with_negative_balance
FROM public.wallets
WHERE balance < 0;

SELECT p.proname, p.oid::regprocedure, p.prosecdef AS security_definer,
       p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
ORDER BY p.proname;

