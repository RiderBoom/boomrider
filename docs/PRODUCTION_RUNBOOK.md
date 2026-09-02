# BoomRider production runbook

This runbook is for the current early-production service. Never paste access
tokens, wallet details, precise locations, or personal data into tickets or chat.

## Ownership and severity

- **SEV-1:** unauthorized access, incorrect wallet balance, duplicated
  settlement, credential leak, or all users unable to order. Stop the affected
  operation, preserve evidence, and notify the system owner immediately.
- **SEV-2:** one role or major workflow unavailable with a workaround. Assign an
  owner and update affected internal users.
- **SEV-3:** isolated UI or non-transactional issue. Record and schedule it.

Record the start time, affected release, affected roles, last known-good time,
and sanitized error identifier. Do not delete logs or edit applied migrations.

## First response

1. Confirm impact with a dedicated test account; do not modify a user's live order.
2. Check Vercel deployment status, Supabase status/logs, Edge Function logs, and
   the most recent GitHub Actions run.
3. Identify whether the failure is frontend, authentication/RLS, database,
   external map/AI provider, or Android-specific.
4. If a new frontend caused the incident, restore the last known-good deployment.
5. If a migration is involved, stop writes to the affected workflow and follow
   `SECURITY_DEPLOYMENT.md`; never restore an old snapshot over newer transactions.

## Wallet or settlement incident

1. Disable the affected approval/settlement workflow without deleting records.
2. Capture order ID, transaction IDs, timestamps, before/after balances, and the
   authenticated actor ID in a restricted incident record.
3. Check for retries or concurrent RPC calls. Do not correct balances from the UI
   or with an unaudited SQL update.
4. Reconcile from immutable transactions and order state. Require a second person
   to review any corrective database operation.
5. Verify the final balance and add a regression test before re-enabling the flow.

## Authentication or credential incident

1. Revoke or rotate the exposed credential at its provider.
2. Remove it from deployment variables and repository history/current tree as needed.
3. Invalidate affected sessions if an auth credential or signing secret was exposed.
4. Review access logs and provider usage for the exposure window.
5. Redeploy, verify with a test account, then document scope and preventive action.

## External provider outage

- **Maps/geocoding:** preserve manually entered addresses and coordinates; do not
  repeatedly retry public Nominatim/OSRM endpoints. Inform users that routing is degraded.
- **Gemini:** local deterministic commands remain available. AI free-form chat may
  show a temporary error; ordering and wallet operations must not depend on Gemini.
- **Push notification:** treat the database order state as authoritative and use
  the internal communication fallback.

## Backup and restore drill

Run at a scheduled time and use a separate, access-controlled project:

1. Record source backup timestamp and row counts for profiles, roles, wallets,
   restaurants, riders, orders, and wallet transaction records.
2. Restore into an isolated non-production environment.
3. Apply no new production writes to the restored copy.
4. Verify schema/migration version, row counts, foreign keys, admin access using a
   synthetic account, and representative read-only queries.
5. Record restore duration, data-loss window, failures, and corrective actions.
6. Delete the restored copy according to the company's data-retention policy.

## Recovery verification

Verify login for each role, create one synthetic order, exercise dispatch without
real payment, confirm wallet invariants, check Edge Function errors, and monitor
for recurrence. Close the incident only after impact and follow-up actions are recorded.
