import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  const msg = [
    'Missing Supabase environment variables.',
    `VITE_SUPABASE_URL: ${supabaseUrl ? 'SET' : 'MISSING'}`,
    `VITE_SUPABASE_ANON_KEY: ${supabaseAnonKey ? 'SET' : 'MISSING'}`,
    'Add them to your .env file. See docs/setup.md for details.',
  ].join('\n');

  if (import.meta.env.DEV) {
    throw new Error(msg);
  }
  console.error(msg);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
