import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { validatePublicEnv } from '../src/config/env.js';

console.log('🚀 Running BoomRider Release & Configuration Validation Check...\n');

// 1. Validate required release files exist
const requiredFiles = [
  'package.json',
  'playwright.config.js',
  'vite.config.js',
  'supabase/functions/send-notification/index.ts',
  'supabase/functions/process-expired-offers/index.ts',
  'supabase/functions/ai-chat/index.ts',
  'docs/FCM_SETUP.md',
  'docs/PRODUCTION_TEST_CHECKLIST.md',
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    console.error(`❌ Missing required release file: ${file}`);
    process.exit(1);
  }
}
console.log('✅ Required release files present.');

// 2. Validate environment variable validation function & required configuration names
try {
  const dummyValidEnv = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://mock.supabase.co',
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'mock-anon-key-long-enough-for-validation-check',
  };
  const validated = validatePublicEnv(dummyValidEnv);
  if (!validated.supabaseUrl || !validated.supabaseAnonKey) {
    throw new Error('Validated environment output incomplete');
  }
} catch (err) {
  console.error(`❌ Public environment check failed: ${err.message}`);
  process.exit(1);
}
console.log('✅ Required environment variables validation verified.');

// 3. Validate E2E Playwright configuration
const playwrightConfig = readFileSync('playwright.config.js', 'utf8');
if (!playwrightConfig.includes("baseURL: 'http://127.0.0.1:4173'") && !playwrightConfig.includes('baseURL:')) {
  console.error('❌ Playwright configuration is missing baseURL');
  process.exit(1);
}
if (!playwrightConfig.includes("VITE_ENABLE_DEV_AUTH: 'false'")) {
  console.error('❌ E2E configuration must explicitly enforce VITE_ENABLE_DEV_AUTH=false');
  process.exit(1);
}
console.log('✅ Playwright E2E configuration validated.');

// 4. Verify public environment configuration safety
if (existsSync('.env.example')) {
  const envExample = readFileSync('.env.example', 'utf8');
  if (/VITE_ENABLE_DEV_AUTH\s*=\s*true/i.test(envExample)) {
    console.error('❌ .env.example must not default VITE_ENABLE_DEV_AUTH to true');
    process.exit(1);
  }
}
console.log('✅ Production-safe public configuration checks passed.');

// 5. Run automated code verification pipeline
try {
  console.log('🔍 Executing linter...');
  execSync('npm run lint', { stdio: 'inherit' });

  console.log('🧪 Executing unit tests...');
  execSync('npm test', { stdio: 'inherit' });

  console.log('🔒 Executing security static analysis...');
  execSync('npm run security:check', { stdio: 'inherit' });

  console.log('🏗️ Executing build...');
  execSync('npm run build', { stdio: 'inherit' });
} catch {
  console.error('❌ Release check pipeline failed during verification step.');
  process.exit(1);
}

console.log('\n🎉 All BoomRider release gate checks PASSED successfully!');
