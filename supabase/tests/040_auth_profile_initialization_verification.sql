BEGIN;

SELECT plan(8);

SELECT ok(
  to_regprocedure('public.handle_new_auth_user()') IS NOT NULL,
  'complete auth account initializer exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND tgname = 'on_auth_user_created_initialize_account'
      AND NOT tgisinternal
  ),
  'consolidated auth initializer trigger exists'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND tgname = 'on_auth_user_created_wallet'
      AND NOT tgisinternal
  ),
  'legacy wallet-only auth trigger is removed'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.handle_new_auth_user()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.handle_new_auth_user()', 'EXECUTE'),
  'initializer cannot be called by application roles'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    LEFT JOIN public.profiles AS p ON p.id = u.id
    WHERE p.id IS NULL
  ),
  'every auth user has a profile'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    LEFT JOIN public.wallets AS w ON w.user_id = u.id::text
    WHERE w.user_id IS NULL
  ),
  'every auth user has a wallet'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    LEFT JOIN public.user_roles AS r
      ON r.user_id = u.id AND r.role = 'customer'
    WHERE r.user_id IS NULL
  ),
  'every auth user has the default customer role'
);

SELECT ok(
  (
    SELECT count(*)
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND tgname IN (
        'on_auth_user_created_wallet',
        'on_auth_user_created_initialize_account'
      )
      AND NOT tgisinternal
  ) = 1,
  'only one BoomRider account initialization trigger remains'
);

SELECT * FROM finish();

ROLLBACK;
