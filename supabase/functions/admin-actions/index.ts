// Edge Function: admin-actions
// Executa operações administrativas que exigem a service_role key
// (convidar usuário, resetar MFA) — por isso NUNCA podem rodar no
// frontend. Só quem já é super_admin/admin_corporativo (verificado aqui
// dentro, a partir do token de quem chamou) pode executar.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_ROLES = ['super_admin', 'admin_corporativo'];

// Chamada direto do navegador (supabase.functions.invoke) — sem esses
// cabeçalhos, o preflight OPTIONS falha e o browser bloqueia a requisição
// antes dela chegar aqui, mesmo com o resto da função correto.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401);

    // Cliente com o token de quem chamou, só para descobrir quem é.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: callerError,
    } = await callerClient.auth.getUser();
    if (callerError || !caller) return json({ error: 'Sessão inválida.' }, 401);

    // Cliente com service_role para as operações privilegiadas de fato.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role_global, company_id')
      .eq('id', caller.id)
      .single();

    if (!callerProfile || !ADMIN_ROLES.includes(callerProfile.role_global)) {
      return json({ error: 'Sem permissão para esta ação.' }, 403);
    }

    const body = await req.json();

    if (body.type === 'invite_user') {
      const { email, full_name, role_global } = body;
      if (!email || !full_name || !role_global) {
        return json({ error: 'Preencha e-mail, nome e papel.' }, 400);
      }

      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name, role_global, company_id: callerProfile.company_id },
      });
      if (error) {
        // DIAGNÓSTICO TEMPORÁRIO — remover depois de identificar a causa do 400.
        return json(
          { error: error.message || 'Erro ao convidar (sem mensagem).', debug: { name: error.name, status: error.status, code: (error as { code?: string }).code } },
          400
        );
      }
      return json({ ok: true, userId: data.user?.id });
    }

    // Cria uma conta de teste já com senha definida e e-mail confirmado —
    // sem depender do fluxo de convite por e-mail (útil pra QA, onde os
    // e-mails de teste não têm caixa de entrada real pra clicar o link).
    // Não permite role_global='super_admin' por aqui: esse papel continua
    // só sendo concedido manualmente pelo dono do projeto.
    if (body.type === 'create_test_user') {
      const { email, full_name, role_global, password, mfa_required, active } = body;
      if (!email || !full_name || !role_global || !password) {
        return json({ error: 'Preencha e-mail, nome, papel e senha.' }, 400);
      }
      if (role_global === 'super_admin') {
        return json({ error: 'Não é possível criar conta de teste com papel super_admin por aqui.' }, 400);
      }
      if (password.length < 8) {
        return json({ error: 'A senha deve ter pelo menos 8 caracteres.' }, 400);
      }

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name,
          role_global,
          company_id: callerProfile.company_id,
          mfa_required: mfa_required !== false,
        },
      });
      if (error) return json({ error: error.message }, 400);

      if (active === false) {
        await admin.from('profiles').update({ active: false }).eq('id', data.user!.id);
      }

      return json({ ok: true, userId: data.user?.id });
    }

    if (body.type === 'reset_mfa') {
      const { userId } = body;
      if (!userId) return json({ error: 'userId ausente.' }, 400);

      const { data: userData, error: getUserError } = await admin.auth.admin.getUserById(userId);
      if (getUserError || !userData?.user) return json({ error: 'Usuário não encontrado.' }, 404);

      const factors = userData.user.factors || [];
      for (const factor of factors) {
        await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      }
      return json({ ok: true, removed: factors.length });
    }

    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erro inesperado.' }, 500);
  }
});
