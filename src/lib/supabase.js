import { createClient } from '@supabase/supabase-js';
import { validatePublicEnv } from '../config/env.js';

const config = validatePublicEnv(import.meta.env);

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  }
);
