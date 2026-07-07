// Edge Function: process-approval
// Aprova ou rejeita a etapa atual de um documento. A reautenticação forte
// (senha ou MFA) exigida antes de assinar é conferida AQUI, de forma
// independente — nunca confiamos em flags que o client alega ter
// verificado sozinho:
//   - se a conta exige MFA: o token de quem chamou já precisa ter o claim
//     "aal2" (só existe se o desafio TOTP realmente aconteceu nesta sessão);
//   - se não exige MFA: a senha enviada é reconferida aqui via GoTrue,
//     de novo, mesmo que o client já tenha checado antes.
// Só depois disso a gravação (etapas, documento, evidência encadeada,
// certificado, notificações, audit_log) é feita por fn_process_approval,
// via service_role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// O Free Plan do Supabase não permite configurar expiração de sessão nem
// timeout de inatividade (isso é Pro Plan+, confirmado no dashboard do
// projeto). Como alternativa, comparamos aqui a idade REAL da sessão
// (auth.sessions.created_at, via fn_session_created_at) contra esse limite.
// Não dá pra usar o claim "iat" do access token pra isso: o client Supabase
// renova o access token sozinho a cada ~55min enquanto a aba fica aberta, e
// cada renovação gera um "iat" novo — uma sessão de semanas ficaria com
// "iat" sempre fresco e o bloqueio nunca disparia.
const MAX_SESSION_AGE_SECONDS = 12 * 60 * 60;

async function getSessionAgeSeconds(
  admin: ReturnType<typeof createClient>,
  claims: Record<string, unknown>,
): Promise<number | null> {
  const sessionId = claims.session_id;
  if (typeof sessionId !== 'string') return null;
  const { data, error } = await admin.rpc('fn_session_created_at', { p_session_id: sessionId });
  if (error || !data) return null;
  const createdAtMs = new Date(data as string).getTime();
  if (Number.isNaN(createdAtMs)) return null;
  return (Date.now() - createdAtMs) / 1000;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);
    const token = authHeader.replace(/^Bearer /, '');

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: callerError,
    } = await callerClient.auth.getUser();
    if (callerError || !caller) return json({ error: 'Sessão inválida.' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, mfa_required, active')
      .eq('id', caller.id)
      .single();

    if (!profile || !profile.active) return json({ error: 'Usuário inativo ou não encontrado.' }, 403);

    const claims = decodeJwtPayload(token);
    const sessionAgeSeconds = await getSessionAgeSeconds(admin, claims);
    if (sessionAgeSeconds !== null && sessionAgeSeconds > MAX_SESSION_AGE_SECONDS) {
      return json({ error: 'Sua sessão está muito antiga. Faça login novamente para aprovar.' }, 401);
    }

    const body = await req.json();
    const { documentId, decision, comment } = body;
    if (!documentId || !['approve', 'reject'].includes(decision)) {
      return json({ error: 'Parâmetros inválidos.' }, 400);
    }

    let authMethod: string;
    let mfaVerified = false;
    let passwordReconfirmed = false;

    if (profile.mfa_required) {
      if (claims.aal !== 'aal2') {
        return json({ error: 'Confirme o código do seu autenticador antes de assinar.' }, 403);
      }
      authMethod = 'totp_mfa';
      mfaVerified = true;
    } else {
      if (!body.password) return json({ error: 'Senha necessária para confirmar a assinatura.' }, 400);
      const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ email: profile.email, password: body.password }),
      });
      if (!verifyResp.ok) return json({ error: 'Senha incorreta.' }, 403);
      authMethod = 'password_reconfirmation';
      passwordReconfirmed = true;
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const userAgent = req.headers.get('user-agent') || null;

    const { data, error } = await admin.rpc('fn_process_approval', {
      p_document_id: documentId,
      p_user_id: caller.id,
      p_decision: decision,
      p_comment: comment || null,
      p_auth_method: authMethod,
      p_mfa_verified: mfaVerified,
      p_password_reconfirmed: passwordReconfirmed,
      p_ip_address: ip,
      p_user_agent: userAgent,
    });

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, document: data });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erro inesperado.' }, 500);
  }
});
