import { renderAppLayout } from '../components/app-sidebar.js';
import { navigate } from '../routes/router.js';
import { getProfile } from '../auth/session.js';
import { activeStepInfo, isOverdue, ageLabel } from '../services/documents.service.js';
import { fetchMyPendingApprovals } from '../services/reports.service.js';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function renderPendentes() {
  const profile = getProfile();
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar"><div><h1>Minhas aprovações</h1><div class="sub">Documentos aguardando a sua decisão na etapa atual</div></div></div>
    ${
      !profile?.mfa_required
        ? `<div class="notice">⚠ Sua conta confirma aprovações apenas por senha. <a href="#mfa-setup">Ative a autenticação em dois fatores (MFA)</a> para assinar com mais segurança.</div>`
        : ''
    }
    <div class="card"><table>
      <thead><tr><th>Título</th><th>Hotel</th><th>Tipo</th><th>Valor</th><th>Solicitante</th><th>Pendente há</th><th>SLA</th><th></th></tr></thead>
      <tbody id="pendBody"><tr><td colspan="8" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const tbody = content.querySelector('#pendBody');

  async function refresh() {
    try {
      const docs = await fetchMyPendingApprovals();
      renderList(docs);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">Erro ao carregar: ${err.message}</td></tr>`;
    }
  }

  function renderList(docs) {
    if (!docs.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Nenhuma aprovação pendente para você no momento. 🎉</td></tr>';
      return;
    }

    tbody.innerHTML = docs
      .map((d) => {
        const info = activeStepInfo(d, d.document_approval_steps || []);
        const overdue = info && isOverdue(info.startedAt, info.step.sla_hours);
        const age = info ? ageLabel(info.startedAt) : '—';
        const slaLabel = info?.step?.sla_hours ? `${info.step.sla_hours}h` : '—';
        return `
        <tr data-id="${d.id}">
          <td class="doc-t">${d.title}</td>
          <td>${d.hotels?.name || ''}</td>
          <td>${d.approval_types?.name || ''}</td>
          <td>${fmt(d.amount)}</td>
          <td>${d.creator?.full_name || ''}</td>
          <td>${overdue ? `<span style="color:var(--danger);font-weight:700">${age} ⚠</span>` : age}</td>
          <td>${
            overdue
              ? `<span class="badge b-no"><span class="dot"></span>Atrasado</span>`
              : slaLabel !== '—'
                ? `<span class="badge b-draft">${slaLabel}</span>`
                : '<span class="badge b-draft">Sem SLA</span>'
          }</td>
          <td><button class="btn btn-brass btn-analyze" style="padding:7px 12px">Analisar</button></td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('.btn-analyze').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('tr').dataset.id;
        navigate('documento', id);
      });
    });
  }

  refresh();

  return renderAppLayout('pendentes', content);
}
