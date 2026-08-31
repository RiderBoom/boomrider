# Authentication and RLS hardening deployment

The security migrations in this change are intentionally schema-only. They do
not modify existing profile, role, wallet, restaurant, rider, order, or chat
rows. Do not run `supabase_schema.sql` against production.

## Preconditions

1. Create a database backup and record current row counts for `profiles`,
   `user_roles`, `wallets`, `restaurants`, `riders`, and `orders`.
2. Confirm migrations through `023_fix_dispatch_and_settlement_system.sql` have
   already been applied. Migration 025 wraps functions created by those files.
3. Confirm at least one existing account has `admin` in `user_roles`.
4. Test first in a staging project restored from a sanitized production backup.
5. Run `supabase/tests/023_production_preflight.sql` read-only and stop if there
   is no admin, an owner relationship is missing, or a wallet is negative.

## No-cost local gate

When paid Supabase branching is not desired, run the full migration chain with
Supabase Local and synthetic data. This does not replace the production
preflight, but catches SQL syntax, missing dependencies, and authorization
regressions without creating a hosted resource.

```bash
supabase start
supabase db reset
```

Do not copy production user data into the local environment.

## Staging order

1. Deploy the frontend containing the RPC-compatible changes.
2. Apply `024_harden_auth_roles_and_wallets.sql` in one transaction.
3. Apply `025_guard_privileged_business_rpcs.sql` in one transaction.
4. Apply `026_harden_domain_rls_and_admin_maintenance.sql` in one transaction.
5. Deploy both Edge Functions after setting `APP_ORIGIN`, `CRON_SECRET`, and
   `NOTIFICATION_WEBHOOK_SECRET`.
6. Run `supabase/tests/024_auth_rls_verification.sql` as a database owner.
7. Exercise customer, merchant, rider, and admin workflows before production.

The old `js_credit_wallet` name remains available, but its implementation now
rejects positive self-credit, cross-user changes by non-admins, and overdrafts.
The privileged dispatch, settlement, offer acceptance, and chat functions retain
their business logic behind participant-checking wrappers.

## Required smoke tests

- Existing users can sign in with email and retain the same UUID.
- A new signup receives a profile, zero-balance wallet, and customer role.
- A customer can debit only their own wallet and cannot make it negative.
- A customer cannot grant themselves merchant, rider, or admin.
- Admin can approve top-ups and change roles.
- Merchant can dispatch only an order connected to their restaurant.
- Rider can accept only an offer addressed to their auth user ID.
- Only order participants can append chat messages or settle an order.
- Counts and wallet balances captured before migration are unchanged immediately
  after migration.

## Rollback

Rollback means restoring the previous frontend deployment and policy/function
definitions captured before deployment. Do not restore an old data snapshot over
new transactions. Migrations 024 and 025 contain no business-data migration, but
their function and policy definitions should be rolled back together to avoid a
frontend/database contract mismatch.

If a staging precondition fails, stop before production. Never edit an already
applied migration; add a new forward migration with the correction.

