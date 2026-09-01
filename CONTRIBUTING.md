# Contributing to BoomRider

## Development workflow

1. Create a focused branch from the latest `main`.
2. Install exact dependencies with `npm ci`.
3. Keep each pull request limited to one feature, fix, or migration.
4. Run the full verification suite before pushing:

   ```bash
   npm run lint
   npm test
   npm run security:check
   npm run build
   ```

5. For database changes, add a new ordered migration and verify it with
   `supabase db reset`. Never edit an applied production migration.
6. Do not commit `.env` files, `google-services.json`, API keys, service-role
   keys, personal data, payment data, or notification tokens.

## Pull requests

- Explain the user-visible outcome and risk.
- Include verification evidence and screenshots for UI changes.
- Call out migrations, environment variables, and rollback steps.
- Do not group unrelated major dependency upgrades in one pull request.
- Wait for required checks before merging.

## Security

Report suspected vulnerabilities privately through GitHub Security Advisories.
Do not include credentials or customer data in public issues.
