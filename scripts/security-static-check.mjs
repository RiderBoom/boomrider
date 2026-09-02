import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const checks = [
  {
    file: 'src/context/AppContext.jsx',
    forbidden: [/from\(['"]user_roles['"]\)\.(?:insert|upsert|update|delete)/],
  },
  {
    file: 'src/context/hooks/useWalletActions.js',
    required: [/rpc\(['"]js_credit_wallet['"]/, /if \(error\) throw error/],
  },
  {
    file: 'supabase/functions/process-expired-offers/index.ts',
    required: [/CRON_SECRET/, /x-cron-secret/],
    forbidden: [/Access-Control-Allow-Origin['"]:\s*['"]\*['"]/],
  },
  {
    file: 'supabase/functions/send-notification/index.ts',
    required: [/NOTIFICATION_WEBHOOK_SECRET/, /x-webhook-secret/],
    forbidden: [/Access-Control-Allow-Origin['"]:\s*['"]\*['"]/],
  },
  {
    file: '.gitignore',
    required: [/^\.env$/m],
  },
  {
    file: 'src/components/AIChatModal.jsx',
    required: [/generateAiReply/],
    forbidden: [/VITE_GEMINI_API_KEY/, /generativelanguage\.googleapis\.com/],
  },
  {
    file: 'supabase/functions/ai-chat/index.ts',
    required: [/GEMINI_API_KEY/, /auth\.getUser\(\)/, /MAX_TEXT_LENGTH/, /Rate limit exceeded/],
    forbidden: [/Access-Control-Allow-Origin['"]:\s*['"]\*['"]/],
  },
];

const failures = [];
for (const check of checks) {
  const source = readFileSync(check.file, 'utf8');
  for (const pattern of check.required ?? []) {
    if (!pattern.test(source)) failures.push(`${check.file}: missing ${pattern}`);
  }
  for (const pattern of check.forbidden ?? []) {
    if (pattern.test(source)) failures.push(`${check.file}: forbidden ${pattern}`);
  }
}

// Scan every tracked text file so previously removed client credentials cannot
// be reintroduced under a different path. Firebase client keys still need API
// and application restrictions; they should be injected during deployment.
const trackedFiles = execFileSync('git', ['ls-files', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const googleApiKeyPattern = /AIza[A-Za-z0-9_-]{35}/;
const clientSecretNamePattern = /VITE_(?:GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET|NOTIFICATION_WEBHOOK_SECRET)/;
for (const file of trackedFiles) {
  try {
    const source = readFileSync(file, 'utf8');
    if (googleApiKeyPattern.test(source)) {
      failures.push(`${file}: tracked Google API key; inject it at build/deploy time instead`);
    }
    if (file !== 'scripts/security-static-check.mjs' && clientSecretNamePattern.test(source)) {
      failures.push(`${file}: server secret uses a VITE_ name and would be exposed to the browser`);
    }
  } catch {
    // Binary and platform-specific files are intentionally skipped.
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Static security checks passed.');

