const REQUIRED_PUBLIC_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

export function validatePublicEnv(env) {
  const missing = REQUIRED_PUBLIC_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `BoomRider configuration is incomplete. Missing: ${missing.join(', ')}`,
    );
  }

  let supabaseUrl;
  try {
    supabaseUrl = new URL(env.VITE_SUPABASE_URL);
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid URL.');
  }

  if (supabaseUrl.protocol !== 'https:' && supabaseUrl.hostname !== '127.0.0.1' && supabaseUrl.hostname !== 'localhost') {
    throw new Error('VITE_SUPABASE_URL must use HTTPS outside local development.');
  }

  if (env.VITE_SUPABASE_ANON_KEY.length < 20) {
    throw new Error('VITE_SUPABASE_ANON_KEY is invalid.');
  }

  return Object.freeze({
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ''),
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,
  });
}
