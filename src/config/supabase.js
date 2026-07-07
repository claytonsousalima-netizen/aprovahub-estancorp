import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Estas chaves são públicas por design: o acesso aos dados é controlado
// inteiramente por Row Level Security (RLS) no Postgres, nunca por este
// arquivo. A service_role key NUNCA deve aparecer no frontend.
export const SUPABASE_URL = 'https://syhztzieyjuvrsmupvxh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qmWE0bUW8vNgG0zmEYKK6A_C8cmLFLG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
