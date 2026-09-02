# Security Policy

## Supported versions

Security fixes are applied to the latest release and the default branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting feature on the Security tab of this repository.
Include reproduction steps, affected components, and the potential impact.

Never include production credentials, access tokens, personal data, or payment
information in a report.

## Client API keys

Firebase and Google client keys must be restricted in Google Cloud Console to
the exact Android package/SHA certificates or approved web referrers, and only
to the APIs the application uses. They must not be committed to this public
repository. Inject platform configuration during trusted build/deployment
steps and keep `google-services.json` out of Git.

If GitHub secret scanning detects a key:

1. Restrict or rotate it in Google Cloud Console immediately.
2. Update the trusted deployment configuration.
3. Confirm web and Android notification flows still work.
4. Remove the key from the current tree and prevent reintroduction in CI.
5. Resolve the GitHub alert only after revocation/restriction is verified.

Gemini is a server-only credential in BoomRider. Store `GEMINI_API_KEY` only as a
Supabase Edge Function secret. Never rename it with a `VITE_` prefix, include it
in `.env.example`, or call the Gemini API directly from browser code. The
`ai-chat` function authenticates the Supabase user, validates request size, and
applies an instance-level burst limit. Provider-side quotas remain required
because instances do not share in-memory counters.
