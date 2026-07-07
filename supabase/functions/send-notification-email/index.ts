// Edge Function: send-notification-email
// Preparação da Etapa 13 — ainda NÃO está conectada a nenhum provedor de
// e-mail de verdade. Existe pra já ter, hoje, o formato certo de chamada
// e os templates prontos; quando alguém configurar um provedor (Resend,
// SendGrid ou SMTP), só é preciso preencher a chamada HTTP lá embaixo e
// colocar a chave como secret do projeto (nunca no frontend).
//
// Como ligar isso na prática mais tarde, sem mexer no resto do app:
//   - criar um Database Webhook no Supabase (Database → Webhooks) que
//     dispara em INSERT na tabela "notifications" e chama esta function;
//   - ou chamar esta function diretamente de outro lugar de confiança.
// Por enquanto ninguém chama esta function automaticamente.

import { buildTemplate } from './templates.ts';

// Nome do secret que um provedor real usaria — não está configurado ainda,
// então a function roda em "modo preparação" (loga e responde ok:false).
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_ADDRESS = Deno.env.get('NOTIFICATIONS_FROM_ADDRESS') || 'AprovaHub <notificacoes@estancorp.com.br>';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const body = await req.json();
    const { notificationType, recipientEmail, templateData } = body;

    if (!notificationType || !recipientEmail) {
      return json({ error: 'Parâmetros inválidos: notificationType e recipientEmail são obrigatórios.' }, 400);
    }

    const template = buildTemplate(notificationType, templateData || {});
    if (!template) {
      return json({ error: `Template desconhecido: ${notificationType}` }, 400);
    }

    if (!RESEND_API_KEY) {
      console.log(`[send-notification-email] modo preparação (sem provedor configurado) — destinatário=${recipientEmail} assunto="${template.subject}"`);
      return json({ ok: true, sent: false, reason: 'Nenhum provedor de e-mail configurado ainda (preparação da Etapa 13).' });
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: recipientEmail,
        subject: template.subject,
        html: template.html,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json({ ok: false, error: errText }, 502);
    }

    return json({ ok: true, sent: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erro inesperado.' }, 500);
  }
});
