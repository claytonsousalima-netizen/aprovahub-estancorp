import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Estas chaves são públicas por design: o acesso aos dados é controlado
// inteiramente por Row Level Security (RLS) no Postgres, nunca por este
// arquivo. A service_role key NUNCA deve aparecer no frontend.
export const SUPABASE_URL = 'https://syhztzieyjuvrsmupvxh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qmWE0bUW8vNgG0zmEYKK6A_C8cmLFLG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Quando uma Edge Function responde com status != 2xx, o supabase-js
// descarta o corpo da resposta e só entrega uma mensagem genérica
// ("Edge Function returned a non-2xx status code") em vez do { error }
// que a função realmente devolveu. Isso escondia mensagens úteis como
// "Senha incorreta." ou "Sem permissão para esta ação." atrás de um erro
// sem informação nenhuma. FunctionsHttpError expõe a Response original em
// error.context — lemos o JSON de lá antes de desistir e usar o genérico.
export async function extractFunctionErrorMessage(error, fallback) {
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // corpo não era JSON — segue para o fallback
    }
  }
  return error?.message || fallback;
}
