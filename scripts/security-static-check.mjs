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

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Static security checks passed.');

