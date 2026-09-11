# BoomRider Production Safety & Deployment Runbook

This document defines the strict procedures for pre-deploy validation, CI checks, staging verification, database backups, production verification, and emergency rollbacks for the BoomRider system.

---

## 1. Core Production Directives

To protect real customer orders and wallet funds, all engineers and deployment operations MUST adhere to these rules:

1. **Zero Direct Production Database Mutations**: Manual `INSERT`, `UPDATE`, `DELETE`, `ALTER`, or `DROP` statements on production databases are strictly prohibited. All changes must be made via idempotent, reviewed SQL migration files.
2. **No Service-Role Keys in Frontend/Client Code**: Service-role keys must never be committed to git or exposed to client browsers.
3. **Small PR Strategy**: Complex changes must be broken into small, isolated Pull Requests (PRs). Do not combine multiple unrelated features or schema changes into a single large PR.
4. **Authoritative Server Transactions**: All wallet transactions, order state transitions, and price calculations must execute through server-authoritative SECURITY DEFINER RPCs with `FOR UPDATE` row locking.

---

## 2. Pre-Deploy Checklist

Before creating a deployment PR or applying database migrations:

- [ ] **Migration Sequence Audit**: Verify migration files in `supabase/migrations/` follow strict sequential ordering (e.g., `036_...`, `037_...`, `038_...`, `039_...`, `040_...`, `041_...`).
- [ ] **RPC Parameter Alignment**: Ensure all parameter names and types passed by the frontend (`src/`) match PostgreSQL function definitions exactly.
- [ ] **Account Initialization Verification**: Ensure `handle_new_auth_user()` trigger is declared on `auth.users` and creates matching records in `public.profiles`, `public.wallets`, and `public.user_roles`.
- [ ] **Immutable Wallet Ledger Check**: Ensure `capture_wallet_ledger_entry` trigger is active on `public.wallets` and `protect_wallet_ledger_entries` trigger blocks `UPDATE` or `DELETE` on `public.wallet_ledger_entries`.
- [ ] **EXECUTE Grants Verification**: Ensure `authenticated` and `service_role` roles are granted explicit `EXECUTE` privileges on required RPCs.

---

## 3. CI Pipeline & Automated Gate Checks

Every Pull Request must pass the following release gate checks locally and in CI before approval:

```bash
# 1. Code Linting
npm run lint

# 2. Automated Unit & Schema Drift Tests
npm test

# 3. Static Security Analysis
npm run security:check

# 4. Release Gate Check
npm run release:check

# 5. Production Web Asset Build
npm run build
```

The CI process enforces that `tests/schema-and-rpc-audit.test.js` passes. If frontend parameter names diverge from SQL signatures, CI will fail immediately.

---

## 4. Staging Verification Steps

Before deploying to Production, changes must be validated in a dedicated Staging environment:

1. **Database Migration Dry-Run**: Apply pending migrations to the Staging Supabase project using Supabase CLI:
   ```bash
   supabase db push --linked
   ```
2. **Schema Cache Refresh**: Send a PostgREST schema reload signal:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```
3. **Automated End-to-End Testing**: Run Playwright E2E test suite against Staging preview:
   ```bash
   npm run test:e2e
   ```
4. **Manual Functional Smoke Verification**:
   - Register a new test user and verify `profiles`, `wallets` (0 balance), and `user_roles` ('customer') are initialized automatically.
   - Place a food/service order and verify quote token consumption.
   - Accept job as rider and verify rider liability checks.
   - Complete order settlement and verify `wallet_ledger_entries` audit records are created.

---

## 5. Database Backup & Disaster Preparedness

Prior to applying any production database schema updates:

1. **Verify Automated PITR**: Confirm Point-In-Time Recovery (PITR) is active in Supabase Dashboard -> Database -> Backups.
2. **Manual Schema & Data Dump**: Create an offsite backup snapshot via `pg_dump`:
   ```bash
   pg_dump "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" \
     --format=custom \
     --file="boomrider_backup_$(date +%Y%m%d_%H%M%S).dump"
   ```
3. **Verify Restoration Target**: Ensure the team knows the PITR recovery timestamp or backup file location before commencing deployment.

---

## 6. Production Verification (SELECT-Only)

After applying migrations and deploying new code to Production:

1. **Execute SELECT-Only Health Check**: Run `scripts/production-health-check.sql` via Supabase SQL Editor or CLI:
   ```bash
   psql "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" -f scripts/production-health-check.sql
   ```
   *Note: This script contains ZERO PII and performs only aggregate SELECT queries.*

2. **Verify Financial Reconciliation Report**: Invoke the admin reconciliation RPC:
   ```sql
   SELECT public.get_financial_reconciliation_report();
   ```
   Verify that:
   - `completedWithoutSettlement` is 0.
   - `cancelledWalletWithoutRefund` is 0.
   - `negativeWallets` is 0.
   - `walletLedgerVarianceCount` is 0.

3. **Verify Realtime WebSockets**: Confirm clients receive live order status and wallet balance updates without full page refreshes.

---

## 7. Emergency Rollback Strategy

If a regression or anomaly is detected in Production:

### Scenario A: Frontend Web Application Bug
1. In Vercel / Hosting Dashboard, select the previous stable deployment build and click **Promote to Production / Instant Rollback**.
2. Verify frontend rolls back immediately (takes < 1 minute).

### Scenario B: Database Migration RPC / Function Issue
1. Prepare a backward-compatible fix migration that reverts or redefines the affected SQL function `CREATE OR REPLACE FUNCTION ...`.
2. Apply the fix migration to Production.
3. Reload PostgREST schema cache (`NOTIFY pgrst, 'reload schema';`).

### Scenario C: Critical Data Corruption / Severe Schema Issue
1. Put the application in Maintenance Mode via App Config or Vercel environment flags.
2. Restore the database to a clean timestamp using Supabase PITR (Point-In-Time Recovery) prior to the faulty deployment.
3. Verify database integrity using `scripts/production-health-check.sql`.
4. Re-enable application traffic.
