# BoomRider Production Rollout & Rollback Runbook

**Document Status:** Production Operational Guideline
**Target Release:** Migration 035 — Server-Authoritative Quote Engine and Pricing Validation

---

## 1. Pre-Deployment Safety Checklist

- [ ] Confirm staging sign-off (`STAGING_TEST_PLAN.md` completed and approved).
- [ ] Take a full production PostgreSQL database backup/snapshot before executing migration SQL.
- [ ] Confirm database connection parameters (`PRODUCTION_DATABASE_URL`).
- [ ] Verify Supabase CLI access with production project credentials.

---

## 2. Production Execution Sequence

### Step 1: Database Migration Execution
Execute `supabase/migrations/035_service_quotes_and_authoritative_pricing.sql` on production database:
```bash
npx supabase db push --db-url "$PRODUCTION_DATABASE_URL"
```
*Note: Migration 035 creates `public.service_quotes` and updates RPCs idempotently with backward compatibility for legacy pre-migration orders.*

### Step 2: Supabase Edge Functions Deployment
Deploy Edge Functions:
```bash
npx supabase functions deploy send-notification --project-ref boomrider-prod
npx supabase functions deploy process-expired-offers --project-ref boomrider-prod
```

### Step 3: Frontend Release Build & Deployment
Build web assets and release to hosting platform:
```bash
npm run release:check
npm run build
# Deploy dist/ to Production CDN / Vercel / Capacitor Android bundle
```

---

## 3. Post-Deployment Monitoring & Observability

Monitor production metrics for **60 minutes** following release:

1. **Quote Engine Success Rate:**
   - Query `public.service_quotes` table to ensure quote generation throughput.
   - Alert threshold: > 2% quote generation failures.
2. **Order Placement Error Rates:**
   - Monitor RPC responses for `QUOTE_EXPIRED`, `QUOTE_ALREADY_USED`, or `INSUFFICIENT_CUSTOMER_WALLET`.
3. **Financial Ledger Equivalence:**
   - Run `node scripts/reconcile-ledger.mjs` every 15 minutes during rollout window.

---

## 4. Rollback Plan & Automated Rollback Triggers

### Rollback Triggers (P0 Incident)
- Rate of `place_customer_order` RPC failures exceeds 5% over 5 consecutive minutes.
- Unhandled database deadlock or lock contention detected in `wallets` or `service_quotes`.
- Discrepancy detected in financial ledger reconciliation balance equation:
  `customerPaid != merchantIncome + riderIncome + adminIncome + refundedAmount`

### Rollback Execution Steps

1. **Rollback Database RPC Definitions:**
   Execute rollback SQL script in Supabase Query Editor:
   ```sql
   -- Revert place_customer_order RPC to Migration 034 state
   -- (See inline comments in 035_service_quotes_and_authoritative_pricing.sql)
   DROP FUNCTION IF EXISTS public.create_service_quote(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC);
   -- Note: Keep public.service_quotes table intact to preserve historical audit records.
   ```

2. **Revert Frontend Application Version:**
   Redeploy previous stable production web bundle and Capacitor APK build.

3. **Notify Platform Incident Response Team:**
   Send alert message to system administrator and log incident post-mortem in repository CHANGELOG.
