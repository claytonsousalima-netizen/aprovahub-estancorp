// Templates de e-mail — preparação da Etapa 13. Nenhum provedor está
// conectado ainda (ver index.ts): isso só define COMO cada notificação
// vira e-mail quando um provedor (Resend/SendGrid/SMTP) for configurado.

interface TemplateResult {
  subject: string;
  html: string;
}

function wrap(title: string, bodyHtml: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#F6F4EF;padding:32px 16px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E4E0D6">
      <div style="background:#0E3A4A;padding:20px 24px">
        <span style="color:#fff;font-size:18px;font-weight:700">AprovaHub</span>
        <span style="color:#C8B98F;font-size:11px;letter-spacing:.08em;text-transform:uppercase;display:block;margin-top:2px">Estancorp</span>
      </div>
      <div style="padding:28px 24px">
        <h2 style="margin:0 0 12px;color:#14232E;font-size:19px">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:16px 24px;background:#FBFAF6;color:#6B7680;font-size:11.5px;border-top:1px solid #E4E0D6">
        Este é um e-mail automático do AprovaHub. Não responda esta mensagem.
      </div>
    </div>
  </div>`;
}

function button(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;margin-top:16px;background:#A8823C;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:13.5px">${label}</a>`;
}

export function buildTemplate(type: string, data: Record<string, unknown> = {}): TemplateResult | null {
  const d = data as Record<string, string | number | undefined>;

  switch (type) {
    case 'approval_pending':
      return {
        subject: `Nova aprovação pendente: ${d.documentTitle}`,
        html: wrap('Nova solicitação aguardando sua aprovação', `
          <p>Olá, ${d.approverName || ''}.</p>
          <p><b>${d.documentTitle}</b> (${d.hotelName || ''}) precisa da sua aprovação.</p>
          <p>Solicitado por: ${d.requesterName || ''}${d.amount ? ` · Valor: ${d.amount}` : ''}</p>
          ${d.link ? button('Analisar solicitação', String(d.link)) : ''}
        `),
      };

    case 'approval_reminder':
      return {
        subject: `Lembrete: aprovação pendente — ${d.documentTitle}`,
        html: wrap('Lembrete de aprovação pendente', `
          <p>Olá, ${d.approverName || ''}.</p>
          <p><b>${d.documentTitle}</b> ainda está aguardando sua decisão.</p>
          ${d.link ? button('Analisar solicitação', String(d.link)) : ''}
        `),
      };

    case 'approved':
      return {
        subject: `Solicitação aprovada: ${d.documentTitle}`,
        html: wrap('Sua solicitação foi aprovada', `
          <p>Olá, ${d.requesterName || ''}.</p>
          <p><b>${d.documentTitle}</b> foi aprovado${d.certificateNumber ? ` — certificado ${d.certificateNumber}` : ''}.</p>
          ${d.link ? button('Ver certificado', String(d.link)) : ''}
        `),
      };

    case 'rejected':
      return {
        subject: `Solicitação reprovada: ${d.documentTitle}`,
        html: wrap('Sua solicitação foi reprovada', `
          <p>Olá, ${d.requesterName || ''}.</p>
          <p><b>${d.documentTitle}</b> foi reprovado.</p>
          ${d.reason ? `<p>Motivo: ${d.reason}</p>` : ''}
          ${d.link ? button('Ver detalhes', String(d.link)) : ''}
        `),
      };

    case 'sla_overdue':
      return {
        subject: `SLA vencido: ${d.documentTitle}`,
        html: wrap('Uma aprovação está fora do prazo', `
          <p>Olá, ${d.approverName || ''}.</p>
          <p><b>${d.documentTitle}</b> (${d.hotelName || ''}) está pendente há mais que o SLA definido${d.slaHours ? ` (${d.slaHours}h)` : ''}.</p>
          ${d.link ? button('Analisar agora', String(d.link)) : ''}
        `),
      };

    case 'comment_received':
      return {
        subject: `Novo comentário: ${d.documentTitle}`,
        html: wrap('Novo comentário na sua solicitação', `
          <p>Olá, ${d.recipientName || ''}.</p>
          <p><b>${d.commenterName || ''}</b> comentou em <b>${d.documentTitle}</b>:</p>
          <p style="background:#FBFAF6;border-left:3px solid #A8823C;padding:10px 14px;color:#3D4A54">${d.commentText || ''}</p>
          ${d.link ? button('Ver conversa', String(d.link)) : ''}
        `),
      };

    case 'user_invited':
      return {
        subject: `Convite para o AprovaHub — ${d.companyName || 'Estancorp'}`,
        html: wrap('Você foi convidado para o AprovaHub', `
          <p>Olá, ${d.inviteeName || ''}.</p>
          <p>Você foi convidado para acessar o portal de aprovações da ${d.companyName || 'Estancorp'}.</p>
          ${d.inviteLink ? button('Aceitar convite e definir senha', String(d.inviteLink)) : ''}
        `),
      };

    default:
      return null;
  }
}
