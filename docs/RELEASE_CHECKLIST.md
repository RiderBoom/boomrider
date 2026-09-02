# BoomRider release checklist

## Before release

- [ ] Change has a user-visible outcome, risk level, owner, and rollback plan.
- [ ] No credentials, personal data, production exports, or signing files are committed.
- [ ] `npm ci`, lint, tests, security check, coverage report, and build pass.
- [ ] Database changes passed isolated rebuild and authorization tests.
- [ ] Staging smoke tests cover customer, merchant, rider, and admin roles.
- [ ] Wallet/order changes cover retry, concurrency, failure, and rollback behavior.
- [ ] Edge Function secrets exist server-side and no server secret uses `VITE_`.
- [ ] Monitoring and sanitized error reporting are enabled for the release.

## Android production release

- [ ] Validate the merged manifest and request location/notification permissions at runtime.
- [ ] Test GPS, photo proof, push notification, session restore, and offline recovery
      on the minimum supported Android version and one current device.
- [ ] Increment `versionCode` and set a user-facing `versionName`.
- [ ] Build a signed AAB using protected CI secrets; never commit a keystore or password.
- [ ] Upload to an internal testing track and complete a clean-install/update smoke test.
- [ ] Retain the release artifact and obfuscation mapping where applicable.

## Deployment

- [ ] Deploy backward-compatible frontend before restrictive database changes when
      required by `SECURITY_DEPLOYMENT.md`.
- [ ] Apply only new forward migrations; never edit an applied migration.
- [ ] Deploy Edge Functions and verify authenticated and unauthorized behavior.
- [ ] Run synthetic smoke tests without real customer money or personal data.
- [ ] Protect the GitHub `staging` environment and configure its Supabase/Vercel
      secrets before running the manual `Deploy staging` workflow.

## After release

- [ ] Watch error rate, auth failures, order creation, dispatch, and settlement.
- [ ] Confirm no unexpected provider quota or public map rate-limit errors.
- [ ] Confirm internal users can complete their normal workflows.
- [ ] Record release SHA, deployment IDs, migration versions, and verification result.
- [ ] Roll back promptly if transaction integrity or authorization is uncertain.
