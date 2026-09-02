import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePublicEnv } from '../src/config/env.js';

const validEnv = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'a-valid-anon-key-with-enough-length',
};

test('accepts a complete Supabase public configuration', () => {
  assert.deepEqual(validatePublicEnv(validEnv), {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: validEnv.VITE_SUPABASE_ANON_KEY,
  });
});
test('reports every missing required public variable', () => {
  assert.throws(
    () => validatePublicEnv({}),
    /VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/,
  );
});

test('rejects non-HTTPS remote Supabase URLs', () => {
  assert.throws(
    () => validatePublicEnv({ ...validEnv, VITE_SUPABASE_URL: 'http://example.com' }),
    /must use HTTPS/,
  );
});

test('permits an HTTP URL for local Supabase development', () => {
  const config = validatePublicEnv({ ...validEnv, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' });
  assert.equal(config.supabaseUrl, 'http://127.0.0.1:54321');
});
