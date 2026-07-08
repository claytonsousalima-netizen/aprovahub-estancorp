import { renderAppLayout } from '../components/app-sidebar.js';
import { getProfile } from '../auth/session.js';
import { toast } from '../components/toast.js';
import { navigate } from '../routes/router.js';
import { openModal } from '../components/modal.js';
import { ROLE_LABEL } from '../constants/roles.js';
import { activeStepInfo, isOverdue, ageLabel } from '../services/documents.service.js';
import { fetchDocumentDetail, fetchAuditLogs, addComment, downloadDocumentFile, getPreviewFileUrl, isPreviewable } from '../services/document-detail.service.js';
import { confirmIdentityForSignature, processApproval, cancelDocument, resendApprovalNotification, canUserApprove } from '../services/approvals.service.js';
import { buildValidationUrl, generateQrDataUrl } from '../services/certificate.service.js';
import { buildProcessPdf, processPdfFileName } from '../services/process-export.service.js';
import {
  fetchQuoteComparison,
  addProposal as addQuoteProposal,
  renameProposal as renameQuoteProposal,
  linkProposalFile as linkQuoteProposalFile,
  removeProposal as removeQuoteProposal,
  addRow as addQuoteRow,
  renameRow as renameQuoteRow,
  removeRow as removeQuoteRow,
  setCellValue as setQuoteCellValue,
} from '../services/quote-comparison.service.js';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_LABEL = { draft: 'Rascunho', pending: 'Pendente', approved: 'Aprovado', rejected: 'Reprovado', cancelled: 'Cancelado', expired: 'Expirado' };
const badgeClass = (status) => ({ pending: 'wait', approved: 'ok', rejected: 'no', draft: 'draft', cancelled: 'no', expired: 'no' }[status] || 'draft');
const ADMIN_LIKE_ROLES = ['super_admin', 'admin_corporativo', 'admin_hotel'];
const NO_COMMENT_ROLES = ['juridico'];
const TABS = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'arquivos', label: 'Arquivos' },
  { id: 'comparativo', label: 'Comparativo' },
  { id: 'historico', label: 'Histórico/Auditoria' },
  { id: 'comentarios', label: 'Comentários' },
  { id: 'certificado', label: 'Certificado' },
];

export function renderDocumento(documentId) {
  const profile = getProfile();
  const content = document.createElement('div');
  content.innerHTML = `<div class="empty" style="padding:60px 20px"><b>Carregando…</b></div>`;

  const state = { doc: null, activeTab: 'resumo', canApprove: false };

  async function load() {
    try {
      state.doc = await fetchDocumentDetail(documentId);
    } catch (err) {
      content.innerHTML = `
        <div class="topbar"><div><h1>Documento</h1></div></div>
        <div class="card empty" style="padding:60px 20px"><b>Não foi possível abrir este documento</b><p>${err.message}</p></div>
      `;
      return;
    }

    state.canApprove = false;
    if (state.doc.status === 'pending') {
      try {
        state.canApprove = await canUserApprove(documentId, profile.id);
      } catch {
        state.canApprove = false;
      }
    }

    try {
      state.auditLogs = await fetchAuditLogs(documentId);
    } catch {
      state.auditLogs = null;
    }

    try {
      state.quoteComparison = await fetchQuoteComparison(documentId);
    } catch {
      state.quoteComparison = { rows: [], proposals: [], values: [] };
    }

    render();
  }

  function render() {
    const doc = state.doc;
    content.innerHTML = `
      <div class="topbar">
        <div><h1>${doc.title}</h1><div class="sub">${doc.hotels?.name || ''} · ${doc.approval_types?.name || ''} · Solicitado por ${doc.creator?.full_name || ''}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="btnViewProcess">👁 Visualizar processo</button>
          <button class="btn btn-brass" id="btnDownloadProcess">⬇ Baixar processo (PDF)</button>
          <button class="btn btn-ghost" id="btnBack">← Voltar</button>
        </div>
      </div>

      <div class="doc-layout">
        <div class="card">
          <div class="doc-head">
            <div>
              <h2>${doc.title}</h2>
              <div class="doc-s">Criado em ${new Date(doc.created_at).toLocaleString('pt-BR')}${doc.certificate_number ? ` · Certificado ${doc.certificate_number}` : ''}</div>
            </div>
            <span class="badge b-${badgeClass(doc.status)}"><span class="dot"></span>${STATUS_LABEL[doc.status] || doc.status}</span>
          </div>

          <div class="meta-grid">
            <div class="meta"><div class="k">Hotel</div><div class="v">${doc.hotels?.name || '—'}</div></div>
            <div class="meta"><div class="k">Tipo</div><div class="v">${doc.approval_types?.name || '—'}</div></div>
            <div class="meta"><div class="k">Valor</div><div class="v">${fmt(doc.amount)}</div></div>
            <div class="meta"><div class="k">Fornecedor</div><div class="v">${doc.supplier_name || '—'}</div></div>
            <div class="meta"><div class="k">Centro de custo</div><div class="v">${doc.cost_center || '—'}</div></div>
            <div class="meta"><div class="k">Solicitante</div><div class="v">${doc.creator?.full_name || '—'}</div></div>
          </div>

          <div class="tabs">
            ${TABS.map((t) => `<button class="tab ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
          </div>

          <div class="tab-panel" id="tabPanel">${renderTabContent()}</div>
        </div>

        <div class="side-panel">
          ${renderSidePanel()}
        </div>
      </div>
    `;
    wireEvents();
  }

  function renderSidePanel() {
    const doc = state.doc;
    let html = '';

    if (state.canApprove) {
      const info = activeStepInfo(doc, doc.document_approval_steps || []);
      const roleLabel = info ? ROLE_LABEL[info.step.role_required] || info.step.role_required : '';
      html += `
        <div class="approve-box">
          <b>Sua aprovação é necessária</b>
          <p>Etapa atual: ${roleLabel}${info?.step?.sla_hours ? ` · SLA ${info.step.sla_hours}h` : ''}</p>
          ${
            !profile?.mfa_required
              ? `<div class="notice" style="margin-top:10px;margin-bottom:0">⚠ Sua conta confirma aprovações apenas por senha. <a href="#mfa-setup">Ative a autenticação em dois fatores (MFA)</a> para assinar com mais segurança.</div>`
              : ''
          }
          <div class="approve-actions">
            <button class="btn btn-ok" id="btnApprove">✓ Aprovar</button>
            <button class="btn btn-danger" id="btnReject">✕ Reprovar</button>
          </div>
        </div>
      `;
    }

    html += `<div class="card panel-pad"><h3>Status</h3>${renderStatusPanel()}</div>`;

    const canCancel = doc.status === 'draft' || doc.status === 'pending' ? profile?.id === doc.created_by || ADMIN_LIKE_ROLES.includes(profile?.role_global) : false;
    const canResend = doc.status === 'pending' && ADMIN_LIKE_ROLES.includes(profile?.role_global);

    if (canCancel || canResend) {
      html += `<div class="card panel-pad">
        <h3>Ações administrativas</h3>
        ${canResend ? '<button class="btn btn-ghost" id="btnResend" style="width:100%;justify-content:center;margin-bottom:8px">Reenviar notificação</button>' : ''}
        ${canCancel ? '<button class="btn btn-danger" id="btnCancel" style="width:100%;justify-content:center">Cancelar solicitação</button>' : ''}
      </div>`;
    }

    return html;
  }

  function renderStatusPanel() {
    const doc = state.doc;
    const steps = [...(doc.document_approval_steps || [])].sort((a, b) => a.step_order - b.step_order);

    if (doc.status !== 'pending') {
      return `<p style="font-size:13px;color:var(--muted)">Este documento está <b>${(STATUS_LABEL[doc.status] || doc.status).toLowerCase()}</b>, não há mais etapas em aberto.</p>`;
    }

    const current = steps.find((s) => s.step_order === doc.current_step_order);
    if (!current) return '<p style="font-size:13px;color:var(--muted)">Etapa atual não encontrada.</p>';

    const info = activeStepInfo(doc, steps);
    const overdue = info && isOverdue(info.startedAt, current.sla_hours);
    const roleLabel = ROLE_LABEL[current.role_required] || current.role_required;
    const who = current.assignee?.full_name || `Qualquer aprovador elegível (${roleLabel})`;

    return `
      <p style="font-size:13px;margin-bottom:6px"><b>Próximo aprovador:</b> ${who}</p>
      <p style="font-size:13px;margin-bottom:6px"><b>Pendente há:</b> ${info ? ageLabel(info.startedAt) : '—'}</p>
      <p style="font-size:13px;color:${overdue ? 'var(--danger)' : 'var(--muted)'}"><b>SLA:</b> ${current.sla_hours ? `${current.sla_hours}h${overdue ? ' — atrasado ⚠' : ''}` : 'Não definido'}</p>
    `;
  }

  function renderTabContent() {
    const doc = state.doc;
    if (state.activeTab === 'resumo') return renderResumo(doc);
    if (state.activeTab === 'arquivos') return renderArquivos(doc);
    if (state.activeTab === 'comparativo') return renderComparativo(doc);
    if (state.activeTab === 'historico') return renderHistorico(doc, state.auditLogs);
    if (state.activeTab === 'comentarios') return renderComentarios(doc);
    if (state.activeTab === 'certificado') return renderCertificado(doc);
    return '';
  }

  function renderResumo(doc) {
    return `
      ${doc.description ? `<p style="margin-bottom:16px"><b>Descrição/justificativa</b><br>${doc.description}</p>` : ''}
      <h3 style="margin-bottom:12px">Linha do tempo das aprovações</h3>
      ${renderRail(doc)}
    `;
  }

  function renderRail(doc) {
    const steps = [...(doc.document_approval_steps || [])].sort((a, b) => a.step_order - b.step_order);
    const evidenceById = new Map((doc.approval_evidences || []).map((e) => [e.id, e]));

    if (!steps.length) return '<div class="empty">Este documento ainda não tem etapas de aprovação (rascunho).</div>';

    return `<div class="rail">${steps
      .map((s) => {
        let cls = '';
        if (s.status === 'approved') cls = 'done';
        else if (s.status === 'rejected') cls = 'rej';
        else if (s.status === 'pending' && s.step_order === doc.current_step_order && doc.status === 'pending') cls = 'now';

        const who = s.status === 'approved' ? s.approver?.full_name || '—' : s.status === 'rejected' ? s.rejecter?.full_name || '—' : s.assignee?.full_name || 'Qualquer aprovador elegível';

        const info = cls === 'now' ? activeStepInfo(doc, steps) : null;
        const overdue = cls === 'now' && info && isOverdue(info.startedAt, s.sla_hours);
        const evidence = s.evidence_id ? evidenceById.get(s.evidence_id) : null;

        return `
        <div class="rail-step ${cls}">
          <div class="rail-n">${s.step_order}</div>
          <div class="rail-body">
            <b>${ROLE_LABEL[s.role_required] || s.role_required}</b>
            <div class="who">${who}</div>
            ${s.status === 'approved' ? `<div class="rail-evid">Aprovado em ${new Date(s.approved_at).toLocaleString('pt-BR')}${evidence ? ` · <span class="mono">${evidence.evidence_hash.slice(0, 16)}…</span>` : ''}</div>` : ''}
            ${s.status === 'rejected' ? `<div class="rail-evid">Reprovado em ${new Date(s.rejected_at).toLocaleString('pt-BR')} — ${s.rejection_reason || 'sem motivo informado'}</div>` : ''}
            ${cls === 'now' ? `<div class="rail-wait-note">${overdue ? '⚠ Fora do prazo de SLA' : 'Aguardando decisão'}</div>` : ''}
          </div>
        </div>`;
      })
      .join('')}</div>`;
  }

  function renderArquivos(doc) {
    const files = [...(doc.document_files || [])].sort((a, b) => a.file_order - b.file_order);
    if (!files.length) return '<div class="empty">Nenhum arquivo anexado.</div>';
    const header =
      files.length > 1
        ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px">
             <button type="button" class="btn btn-brass" id="btnPreviewAll" style="padding:7px 12px">👁 Visualizar todos</button>
           </div>`
        : '';
    const list = files
      .map(
        (f) => `
      <div class="file-item" data-id="${f.id}">
        <div class="fnum">${f.file_order}</div>
        <div><b>${f.original_filename}</b><br><span>${((f.size_bytes || 0) / 1024).toFixed(0)} KB</span></div>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button type="button" class="btn btn-ghost btn-preview-file" style="padding:6px 10px">Visualizar</button>
          <button type="button" class="btn btn-ghost btn-download-file" style="padding:6px 10px">Baixar</button>
        </div>
      </div>`
      )
      .join('');
    return header + list;
  }

  // Só quem criou o documento (ou um admin) pode montar/editar o
  // comparativo, e só enquanto o documento ainda não foi decidido — depois
  // de aprovado/reprovado a tela vira somente leitura pra todo mundo,
  // igual ao restante do processo.
  function canEditComparativo(doc) {
    return (doc.status === 'draft' || doc.status === 'pending') && (profile?.id === doc.created_by || ADMIN_LIKE_ROLES.includes(profile?.role_global));
  }

  function renderComparativo(doc) {
    const qc = state.quoteComparison || { rows: [], proposals: [], values: [] };
    const canEdit = canEditComparativo(doc);
    const files = doc.document_files || [];
    const valueMap = new Map(qc.values.map((v) => [`${v.row_id}:${v.proposal_id}`, v.value]));

    let html = `<div class="notice" style="margin-bottom:14px">Comparativo opcional das propostas anexadas — não é obrigatório preencher; os arquivos originais continuam disponíveis na aba Arquivos.</div>`;

    if (!qc.proposals.length) {
      html += `<div class="empty">Nenhuma proposta adicionada ainda.</div>`;
    } else {
      html += `<div style="overflow-x:auto"><table class="quote-table" style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr>
          <td style="min-width:130px"></td>
          ${qc.proposals
            .map(
              (p) => `
            <td data-proposal-id="${p.id}" style="padding:6px 8px;vertical-align:top;min-width:170px">
              <div style="display:flex;align-items:center;gap:6px">
                ${
                  canEdit
                    ? `<input class="qc-proposal-label" data-proposal-id="${p.id}" value="${p.label}" style="font-size:12.5px;font-weight:700;border:1px solid transparent;background:transparent;width:100%;padding:3px 4px;border-radius:6px">
                       <button type="button" class="btn-icon qc-remove-proposal" data-proposal-id="${p.id}" title="Remover proposta" style="border:none;background:none;color:var(--danger);cursor:pointer;font-size:14px">✕</button>`
                    : `<b>${p.label}</b>`
                }
              </div>
              <div style="margin-top:4px">
                ${
                  canEdit
                    ? `<select class="qc-proposal-file" data-proposal-id="${p.id}" style="font-size:11px;padding:3px 5px;max-width:100%">
                         <option value="">Sem arquivo vinculado</option>
                         ${files.map((f) => `<option value="${f.id}" ${f.id === p.file_id ? 'selected' : ''}>${f.original_filename}</option>`).join('')}
                       </select>`
                    : p.file_id && p.document_files
                      ? `<button type="button" class="qc-view-file" data-file-id="${p.file_id}" style="border:none;background:none;color:var(--petrol);cursor:pointer;font-size:11px;padding:0;text-decoration:underline">📎 ${p.document_files.original_filename}</button>`
                      : `<span style="color:var(--muted);font-size:11px">sem arquivo vinculado</span>`
                }
              </div>
            </td>`
            )
            .join('')}
        </tr></thead>
        <tbody>
          ${qc.rows
            .map(
              (r) => `
            <tr data-row-id="${r.id}">
              <td style="padding:6px 8px;white-space:nowrap;border-top:1px solid var(--line)">
                ${
                  canEdit
                    ? `<div style="display:flex;align-items:center;gap:6px">
                         <input class="qc-row-label" data-row-id="${r.id}" value="${r.label}" style="font-size:12.5px;font-weight:600;border:1px solid transparent;background:transparent;width:130px;padding:3px 4px;border-radius:6px">
                         <button type="button" class="btn-icon qc-remove-row" data-row-id="${r.id}" title="Remover linha" style="border:none;background:none;color:var(--danger);cursor:pointer;font-size:13px">✕</button>
                       </div>`
                    : `<b>${r.label}</b>`
                }
              </td>
              ${qc.proposals
                .map((p) => {
                  const val = valueMap.get(`${r.id}:${p.id}`) || '';
                  return `<td style="padding:6px 8px;border-top:1px solid var(--line)">${
                    canEdit
                      ? `<input class="qc-cell" data-row-id="${r.id}" data-proposal-id="${p.id}" value="${val}" style="width:100%;box-sizing:border-box;font-size:12.5px;padding:6px 8px;border:1px solid var(--line);border-radius:6px">`
                      : val || '<span style="color:var(--muted)">—</span>'
                  }</td>`;
                })
                .join('')}
            </tr>`
            )
            .join('')}
        </tbody>
      </table></div>`;

      if (canEdit) {
        html += `<button type="button" class="btn btn-ghost" id="btnAddQuoteRow" style="margin-top:10px">+ Adicionar linha</button>`;
      }
    }

    if (canEdit) {
      html += `
        <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">
          <h4 style="margin-bottom:8px">Adicionar proposta</h4>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input id="newProposalLabel" placeholder="Nome do fornecedor/proposta" style="flex:1;min-width:160px">
            <select id="newProposalFile" style="min-width:160px">
              <option value="">Sem arquivo vinculado</option>
              ${files.map((f) => `<option value="${f.id}">${f.original_filename}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-brass" id="btnAddProposal">+ Adicionar</button>
          </div>
        </div>`;
    }

    return html;
  }

  function renderHistorico(doc, auditLogs) {
    const events = [{ t: doc.created_at, label: `Documento criado por ${doc.creator?.full_name || ''}`, icon: '📄' }];
    for (const s of doc.document_approval_steps || []) {
      if (s.approved_at) events.push({ t: s.approved_at, label: `${ROLE_LABEL[s.role_required] || s.role_required} aprovado por ${s.approver?.full_name || ''}`, icon: '✅' });
      if (s.rejected_at) events.push({ t: s.rejected_at, label: `${ROLE_LABEL[s.role_required] || s.role_required} reprovado por ${s.rejecter?.full_name || ''}: ${s.rejection_reason || ''}`, icon: '❌' });
    }
    events.sort((a, b) => new Date(b.t) - new Date(a.t));

    let html = events
      .map(
        (e) => `<div class="hist-item"><div class="hist-ic">${e.icon}</div><div><b>${e.label}</b></div><div class="t">${new Date(e.t).toLocaleString('pt-BR')}</div></div>`
      )
      .join('');

    // Só ações que representam decisão de fato tomada entram aqui — 'view'/'download'
    // (registrados só pra auditoria de acesso) não significam que o documento foi
    // aprovado/reprovado, e mostrá-los como "evidência de assinatura" confunde o
    // usuário enquanto os botões de aprovar/reprovar ainda estão ativos.
    const SIGNATURE_EVIDENCE_ACTIONS = new Set(['approve', 'reject', 'certificate_generated']);
    const evid = [...(doc.approval_evidences || [])]
      .filter((e) => SIGNATURE_EVIDENCE_ACTIONS.has(e.action))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (evid.length) {
      html += `<h3 style="margin:18px 0 8px">Evidências de assinatura</h3>`;
      html += evid
        .map(
          (e) => `
        <div class="rail-evid" style="margin-bottom:8px">
          <b>${e.action}</b> por ${e.profiles?.full_name || ''}${e.user_email ? ` (${e.user_email})` : ''}${e.user_role ? ` · ${ROLE_LABEL[e.user_role] || e.user_role} na época` : ''} em ${new Date(e.created_at).toLocaleString('pt-BR')}
          · ${e.mfa_verified ? 'MFA verificado' : e.password_reconfirmed ? 'Senha reconfirmada' : 'sem reautenticação'}
          ${e.rejection_reason ? `<div style="margin-top:4px">Motivo: ${e.rejection_reason}</div>` : ''}
          <div class="mono">${e.evidence_hash}</div>
        </div>`
        )
        .join('');
    }

    if (auditLogs && auditLogs.length) {
      html += `<h3 style="margin:18px 0 8px">Log de auditoria (administrativo)</h3>`;
      html += auditLogs
        .map(
          (l) => `<div class="hist-item"><div class="hist-ic">🔒</div><div><b>${l.action}</b><span>${l.profiles?.full_name || 'sistema'}</span></div><div class="t">${new Date(l.created_at).toLocaleString('pt-BR')}</div></div>`
        )
        .join('');
    } else if (auditLogs === null) {
      html += `<div class="notice" style="margin-top:14px">🔒 O log de auditoria administrativo é visível apenas para perfis de gestão/auditoria.</div>`;
    }

    return html;
  }

  function renderComentarios(doc) {
    const canComment = !NO_COMMENT_ROLES.includes(profile?.role_global);
    const comments = [...(doc.document_comments || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return `
      <div id="commentsList">${
        comments.length
          ? comments
              .map(
                (c) => `
        <div class="hist-item"><div class="hist-ic">💬</div><div><b>${c.profiles?.full_name || ''}${c.internal_only ? ' <span class="badge b-draft">Interno</span>' : ''}</b><span>${c.comment}</span></div><div class="t">${new Date(c.created_at).toLocaleString('pt-BR')}</div></div>`
              )
              .join('')
          : '<div class="empty">Nenhum comentário ainda.</div>'
      }</div>
      ${
        canComment
          ? `<div class="field" style="margin-top:16px"><label>Novo comentário</label><textarea id="newComment"></textarea></div>
             <button class="btn btn-brass" id="btnComment" style="margin-top:8px">Comentar</button>`
          : ''
      }
    `;
  }

  function renderCertificado(doc) {
    if (doc.status !== 'approved' || !doc.certificate_number) {
      return '<div class="empty">Certificado disponível somente após a aprovação final do documento.</div>';
    }

    const steps = [...(doc.document_approval_steps || [])].filter((s) => s.status === 'approved').sort((a, b) => a.step_order - b.step_order);
    const evidenceById = new Map((doc.approval_evidences || []).map((e) => [e.id, e]));

    return `
      <div id="certPrintArea">
        <div class="stamp">✓ Aprovado</div>
        <div class="cert" style="margin-top:14px">
          <div class="meta-grid" style="grid-template-columns:repeat(2,1fr)">
            <div class="meta"><div class="k">Empresa</div><div class="v">${doc.companies?.name || 'Estancorp'}</div></div>
            <div class="meta"><div class="k">Nº do certificado</div><div class="v mono">${doc.certificate_number}</div></div>
            <div class="meta"><div class="k">Documento</div><div class="v">${doc.title}</div></div>
            <div class="meta"><div class="k">Nº do documento</div><div class="v mono" style="font-size:10.5px">${doc.id}</div></div>
            <div class="meta"><div class="k">Tipo</div><div class="v">${doc.approval_types?.name || ''}</div></div>
            <div class="meta"><div class="k">Hotel</div><div class="v">${doc.hotels?.name || ''}</div></div>
            <div class="meta"><div class="k">Valor</div><div class="v">${fmt(doc.amount)}</div></div>
            <div class="meta"><div class="k">Fornecedor</div><div class="v">${doc.supplier_name || '—'}</div></div>
            <div class="meta"><div class="k">Solicitante</div><div class="v">${doc.creator?.full_name || ''}</div></div>
            <div class="meta"><div class="k">Criado em</div><div class="v">${new Date(doc.created_at).toLocaleString('pt-BR')}</div></div>
            <div class="meta"><div class="k">Aprovação final</div><div class="v">${new Date(doc.final_decision_at).toLocaleString('pt-BR')}</div></div>
            <div class="meta"><div class="k">Hash final</div><div class="mono" style="font-size:10.5px">${doc.final_hash || '—'}</div></div>
          </div>
        </div>

        <h3 style="margin:18px 0 8px">Aprovadores (em ordem)</h3>
        ${steps
          .map((s) => {
            const ev = s.evidence_id ? evidenceById.get(s.evidence_id) : null;
            const authLabel = ev?.mfa_verified ? 'MFA verificado' : ev?.password_reconfirmed ? 'Senha reconfirmada' : 'sem reautenticação registrada';
            return `
          <div class="rule-row">
            <div class="rn">${s.step_order}</div>
            <div>
              <b>${s.approver?.full_name || '—'} — ${ROLE_LABEL[s.role_required] || s.role_required}</b>
              <span>${new Date(s.approved_at).toLocaleString('pt-BR')} · ${authLabel} · IP ${ev?.ip_address || '—'}</span>
            </div>
          </div>`;
          })
          .join('')}

        <div class="notice" style="margin-top:18px">
          Este certificado comprova a trilha eletrônica de aprovação interna deste documento, com registro de autenticação, evidências técnicas e integridade dos arquivos anexos.
        </div>

        <div style="margin-top:16px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          <div id="certQr"></div>
          <div style="font-size:11.5px;color:var(--muted)">
            Validar este certificado:<br><span class="mono" id="certValidationLink" style="word-break:break-all"></span>
          </div>
        </div>
      </div>

      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-brass" id="btnPrintCert">Imprimir / Salvar PDF</button>
        <button class="btn btn-ghost" id="btnDownloadCert">Baixar (.txt)</button>
      </div>
    `;
  }

  function wireEvents() {
    content.querySelector('#btnBack').addEventListener('click', () => history.back());

    content.querySelector('#btnViewProcess').addEventListener('click', (e) => handleExportProcess('view', e.currentTarget));
    content.querySelector('#btnDownloadProcess').addEventListener('click', (e) => handleExportProcess('download', e.currentTarget));

    content.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        content.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.activeTab));
        content.querySelector('#tabPanel').innerHTML = renderTabContent();
        wireTabEvents();
      });
    });
    wireTabEvents();

    const btnApprove = content.querySelector('#btnApprove');
    const btnReject = content.querySelector('#btnReject');
    if (btnApprove) btnApprove.addEventListener('click', () => handleDecision('approve'));
    if (btnReject) btnReject.addEventListener('click', () => handleDecision('reject'));

    const btnCancel = content.querySelector('#btnCancel');
    if (btnCancel) btnCancel.addEventListener('click', handleCancel);

    const btnResend = content.querySelector('#btnResend');
    if (btnResend) btnResend.addEventListener('click', handleResend);
  }

  function wireTabEvents() {
    content.querySelectorAll('.btn-download-file').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const fileId = btn.closest('[data-id]').dataset.id;
        const file = state.doc.document_files.find((f) => f.id === fileId);
        try {
          await downloadDocumentFile(file, { documentId, userId: profile?.id });
        } catch (err) {
          toast(`⚠ ${err.message}`);
        }
      });
    });

    content.querySelectorAll('.btn-preview-file').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fileId = btn.closest('[data-id]').dataset.id;
        const file = state.doc.document_files.find((f) => f.id === fileId);
        openFileViewer([file]);
      });
    });

    const btnPreviewAll = content.querySelector('#btnPreviewAll');
    if (btnPreviewAll) {
      btnPreviewAll.addEventListener('click', () => {
        const files = [...(state.doc.document_files || [])].sort((a, b) => a.file_order - b.file_order);
        openFileViewer(files);
      });
    }

    wireComparativoEvents();

    const btnComment = content.querySelector('#btnComment');
    if (btnComment) {
      btnComment.addEventListener('click', async () => {
        const textarea = content.querySelector('#newComment');
        const text = textarea.value.trim();
        if (!text) return;
        btnComment.disabled = true;
        try {
          await addComment(documentId, profile.id, text);
          toast('✅ Comentário adicionado');
          await load();
          state.activeTab = 'comentarios';
          render();
        } catch (err) {
          toast(`⚠ ${err.message}`);
          btnComment.disabled = false;
        }
      });
    }

    const btnDownloadCert = content.querySelector('#btnDownloadCert');
    if (btnDownloadCert) btnDownloadCert.addEventListener('click', () => downloadCertificate(state.doc));

    const btnPrintCert = content.querySelector('#btnPrintCert');
    if (btnPrintCert) btnPrintCert.addEventListener('click', () => window.print());

    const certQr = content.querySelector('#certQr');
    if (certQr && state.doc.certificate_number) {
      const url = buildValidationUrl(state.doc.certificate_number);
      const linkEl = content.querySelector('#certValidationLink');
      if (linkEl) linkEl.textContent = url;
      generateQrDataUrl(url).then((dataUrl) => {
        if (dataUrl && content.contains(certQr)) {
          certQr.innerHTML = `<img src="${dataUrl}" width="120" height="120" alt="QR Code de validação do certificado">`;
        }
      });
    }
  }

  // Depois de qualquer alteração estrutural (adicionar/remover linha ou
  // proposta) redesenha a tabela inteira. Edições de texto (label de
  // linha/proposta, valor de célula) só salvam no banco ao sair do campo
  // ("change", não "input") e não redesenham nada — o campo já mostra o
  // que foi digitado, redesenhar do zero só arriscaria perder o foco.
  function rerenderComparativo() {
    content.querySelector('#tabPanel').innerHTML = renderComparativo(state.doc);
    wireTabEvents();
  }

  function wireComparativoEvents() {
    if (state.activeTab !== 'comparativo') return;

    content.querySelectorAll('.qc-cell').forEach((input) => {
      input.addEventListener('change', async () => {
        const { rowId, proposalId } = input.dataset;
        try {
          await setQuoteCellValue({ documentId, rowId, proposalId, value: input.value });
          const qc = state.quoteComparison;
          const existing = qc.values.find((v) => v.row_id === rowId && v.proposal_id === proposalId);
          if (existing) existing.value = input.value;
          else qc.values.push({ row_id: rowId, proposal_id: proposalId, value: input.value });
        } catch (err) {
          toast(`⚠ ${err.message}`);
        }
      });
    });

    content.querySelectorAll('.qc-row-label').forEach((input) => {
      input.addEventListener('change', async () => {
        const rowId = input.dataset.rowId;
        try {
          await renameQuoteRow(rowId, input.value);
          const row = state.quoteComparison.rows.find((r) => r.id === rowId);
          if (row) row.label = input.value;
        } catch (err) {
          toast(`⚠ ${err.message}`);
        }
      });
    });

    content.querySelectorAll('.qc-proposal-label').forEach((input) => {
      input.addEventListener('change', async () => {
        const proposalId = input.dataset.proposalId;
        try {
          await renameQuoteProposal(proposalId, input.value);
          const proposal = state.quoteComparison.proposals.find((p) => p.id === proposalId);
          if (proposal) proposal.label = input.value;
        } catch (err) {
          toast(`⚠ ${err.message}`);
        }
      });
    });

    content.querySelectorAll('.qc-proposal-file').forEach((select) => {
      select.addEventListener('change', async () => {
        const proposalId = select.dataset.proposalId;
        try {
          await linkQuoteProposalFile(proposalId, select.value || null);
          const proposal = state.quoteComparison.proposals.find((p) => p.id === proposalId);
          if (proposal) proposal.file_id = select.value || null;
        } catch (err) {
          toast(`⚠ ${err.message}`);
        }
      });
    });

    content.querySelectorAll('.qc-view-file').forEach((btn) => {
      btn.addEventListener('click', () => {
        const file = state.doc.document_files.find((f) => f.id === btn.dataset.fileId);
        if (file) openFileViewer([file]);
      });
    });

    content.querySelectorAll('.qc-remove-row').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remover esta linha do comparativo?')) return;
        try {
          await removeQuoteRow(btn.dataset.rowId);
          const qc = state.quoteComparison;
          qc.rows = qc.rows.filter((r) => r.id !== btn.dataset.rowId);
          qc.values = qc.values.filter((v) => v.row_id !== btn.dataset.rowId);
          rerenderComparativo();
        } catch (err) {
          toast(`⚠ ${err.message}`);
        }
      });
    });

    content.querySelectorAll('.qc-remove-proposal').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remover esta proposta do comparativo? Os valores digitados dela serão perdidos (o arquivo anexado continua na aba Arquivos).')) return;
        try {
          await removeQuoteProposal(btn.dataset.proposalId);
          const qc = state.quoteComparison;
          qc.proposals = qc.proposals.filter((p) => p.id !== btn.dataset.proposalId);
          qc.values = qc.values.filter((v) => v.proposal_id !== btn.dataset.proposalId);
          rerenderComparativo();
        } catch (err) {
          toast(`⚠ ${err.message}`);
        }
      });
    });

    const btnAddQuoteRow = content.querySelector('#btnAddQuoteRow');
    if (btnAddQuoteRow) {
      btnAddQuoteRow.addEventListener('click', async () => {
        const label = prompt('Nome da linha (ex.: Garantia, Frete, Item específico):');
        if (!label || !label.trim()) return;
        try {
          const qc = state.quoteComparison;
          const row = await addQuoteRow({ documentId, label: label.trim(), rowCount: qc.rows.length });
          qc.rows.push(row);
          rerenderComparativo();
        } catch (err) {
          toast(`⚠ ${err.message}`);
        }
      });
    }

    const btnAddProposal = content.querySelector('#btnAddProposal');
    if (btnAddProposal) {
      btnAddProposal.addEventListener('click', async () => {
        const labelInput = content.querySelector('#newProposalLabel');
        const fileSelect = content.querySelector('#newProposalFile');
        const label = labelInput.value.trim();
        if (!label) {
          toast('⚠ Informe um nome para a proposta (ex.: nome do fornecedor).');
          return;
        }
        btnAddProposal.disabled = true;
        try {
          const qc = state.quoteComparison;
          const { proposal, newRows } = await addQuoteProposal({
            documentId,
            label,
            fileId: fileSelect.value || null,
            userId: profile.id,
            hasExistingRows: qc.rows.length > 0,
            proposalCount: qc.proposals.length,
          });
          qc.proposals.push(proposal);
          if (newRows.length) qc.rows.push(...newRows);
          rerenderComparativo();
        } catch (err) {
          toast(`⚠ ${err.message}`);
        } finally {
          btnAddProposal.disabled = false;
        }
      });
    }
  }

  // Mostra um ou vários arquivos de uma vez, sem baixar — PDF e imagem
  // renderizam inline (iframe/img); os demais tipos (xls/doc etc.) o
  // navegador não sabe pré-visualizar sozinho, então caem num link de
  // abrir/baixar em vez de travar a tela com um erro.
  async function openFileViewer(files) {
    const { modal, close } = openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3 style="margin:0">${files.length > 1 ? `Visualizar arquivos (${files.length})` : 'Visualizar arquivo'}</h3>
        <button type="button" class="btn btn-ghost" id="btnCloseViewer" style="padding:6px 12px">Fechar</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:24px;max-height:75vh;overflow:auto">
        ${files.map((f) => `<div class="empty" style="padding:30px" data-viewer-slot="${f.id}">Carregando ${f.original_filename}…</div>`).join('')}
      </div>
    `);
    modal.style.maxWidth = '90vw';
    modal.style.width = '90vw';
    modal.querySelector('#btnCloseViewer').addEventListener('click', close);

    for (const f of files) {
      const slot = modal.querySelector(`[data-viewer-slot="${f.id}"]`);
      if (!slot) continue;
      try {
        const url = await getPreviewFileUrl(f, { documentId, userId: profile?.id });
        if (isPreviewable(f)) {
          slot.outerHTML =
            f.mime_type === 'application/pdf'
              ? `<div>
                   <div style="font-size:13px;font-weight:600;margin-bottom:6px">${f.original_filename}</div>
                   <iframe src="${url}" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:10px" title="${f.original_filename}"></iframe>
                 </div>`
              : `<div>
                   <div style="font-size:13px;font-weight:600;margin-bottom:6px">${f.original_filename}</div>
                   <img src="${url}" alt="${f.original_filename}" style="max-width:100%;border:1px solid var(--line);border-radius:10px">
                 </div>`;
        } else {
          slot.outerHTML = `
            <div class="notice">
              Pré-visualização não disponível para este tipo de arquivo (${f.original_filename}).
              <a href="${url}" target="_blank" rel="noopener">Abrir/baixar em nova aba</a>
            </div>`;
        }
      } catch (err) {
        slot.outerHTML = `<div class="notice" style="color:var(--danger)">Erro ao carregar ${f.original_filename}: ${err.message}</div>`;
      }
    }
  }

  function openDecisionModal(decision) {
    const isReject = decision === 'reject';
    return new Promise((resolve, reject) => {
      const { modal, close } = openModal(`
        <h3>${isReject ? 'Reprovar solicitação' : 'Aprovar solicitação'}</h3>
        <p>${isReject ? 'Informe o motivo da reprovação.' : 'Comentário opcional para registrar junto com a aprovação.'}</p>
        <div class="field"><textarea id="decisionComment"></textarea></div>
        <div id="decisionError" style="color:var(--danger);font-size:12.5px;margin-top:8px;display:none"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="btnCancelDecision">Cancelar</button>
          <button class="btn ${isReject ? 'btn-danger' : 'btn-ok'}" id="btnConfirmDecision">${isReject ? 'Reprovar' : 'Aprovar'}</button>
        </div>
      `);
      modal.querySelector('#btnCancelDecision').addEventListener('click', () => {
        close();
        reject(new Error('cancelled'));
      });
      modal.querySelector('#btnConfirmDecision').addEventListener('click', () => {
        const comment = modal.querySelector('#decisionComment').value.trim();
        if (isReject && !comment) {
          const errorBox = modal.querySelector('#decisionError');
          errorBox.textContent = 'Informe o motivo da reprovação.';
          errorBox.style.display = 'block';
          return;
        }
        close();
        resolve(comment);
      });
    });
  }

  async function handleDecision(decision) {
    try {
      const comment = await openDecisionModal(decision);
      const auth = await confirmIdentityForSignature();
      await processApproval({ documentId, decision, comment, password: auth.password });
      toast(decision === 'approve' ? '✅ Documento aprovado' : '⚠ Documento reprovado');
      await load();
    } catch (err) {
      if (err.message !== 'cancelled') toast(`⚠ ${err.message}`);
    }
  }

  async function handleCancel() {
    if (!confirm('Cancelar esta solicitação? Essa ação não pode ser desfeita.')) return;
    const reason = prompt('Motivo do cancelamento (opcional):') || '';
    try {
      await cancelDocument(documentId, reason);
      toast('✅ Solicitação cancelada');
      await load();
    } catch (err) {
      toast(`⚠ ${err.message}`);
    }
  }

  async function handleResend() {
    try {
      const count = await resendApprovalNotification(documentId);
      toast(`✅ Notificação reenviada para ${count} pessoa(s)`);
    } catch (err) {
      toast(`⚠ ${err.message}`);
    }
  }

  async function handleExportProcess(mode, triggerBtn) {
    const btnView = content.querySelector('#btnViewProcess');
    const btnDownload = content.querySelector('#btnDownloadProcess');
    const originalLabel = triggerBtn.textContent;
    [btnView, btnDownload].forEach((b) => b && (b.disabled = true));
    triggerBtn.textContent = 'Gerando PDF…';
    try {
      const blob = await buildProcessPdf(state.doc, state.auditLogs, { userId: profile?.id, quoteComparison: state.quoteComparison });
      const url = URL.createObjectURL(blob);
      if (mode === 'view') {
        window.open(url, '_blank', 'noopener');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = processPdfFileName(state.doc);
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast(`⚠ Não foi possível gerar o PDF do processo: ${err.message}`);
    } finally {
      [btnView, btnDownload].forEach((b) => b && (b.disabled = false));
      triggerBtn.textContent = originalLabel;
    }
  }

  function downloadCertificate(doc) {
    const steps = [...(doc.document_approval_steps || [])].filter((s) => s.status === 'approved').sort((a, b) => a.step_order - b.step_order);
    const evidenceById = new Map((doc.approval_evidences || []).map((e) => [e.id, e]));
    const lines = [
      `CERTIFICADO DE APROVAÇÃO — ${doc.certificate_number}`,
      `Empresa: ${doc.companies?.name || 'Estancorp'}`,
      `Documento: ${doc.title}`,
      `Nº do documento: ${doc.id}`,
      `Hotel: ${doc.hotels?.name || ''}`,
      `Tipo: ${doc.approval_types?.name || ''}`,
      `Valor: ${fmt(doc.amount)}`,
      `Fornecedor: ${doc.supplier_name || '—'}`,
      `Solicitante: ${doc.creator?.full_name || ''}`,
      `Criado em: ${new Date(doc.created_at).toLocaleString('pt-BR')}`,
      `Aprovação final: ${new Date(doc.final_decision_at).toLocaleString('pt-BR')}`,
      `Hash final: ${doc.final_hash || ''}`,
      '',
      'Aprovadores (em ordem):',
      ...steps.map((s) => {
        const ev = s.evidence_id ? evidenceById.get(s.evidence_id) : null;
        const authLabel = ev?.mfa_verified ? 'MFA verificado' : ev?.password_reconfirmed ? 'senha reconfirmada' : 'sem reautenticação registrada';
        return `  ${s.step_order}. ${s.approver?.full_name || ''} — ${ROLE_LABEL[s.role_required] || s.role_required} — ${s.approved_at ? new Date(s.approved_at).toLocaleString('pt-BR') : ''} — ${authLabel} — IP ${ev?.ip_address || '—'}`;
      }),
      '',
      'Validar este certificado:',
      buildValidationUrl(doc.certificate_number),
      '',
      'Este certificado comprova a trilha eletrônica de aprovação interna deste documento, com registro de autenticação, evidências técnicas e integridade dos arquivos anexos.',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `certificado-${doc.certificate_number}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  load();

  return renderAppLayout('', content);
}
