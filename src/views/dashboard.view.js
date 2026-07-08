import { renderAppLayout } from '../components/app-sidebar.js';
import { getProfile } from '../auth/session.js';
import { toast } from '../components/toast.js';
import { navigate } from '../routes/router.js';
import { ROLE_LABEL } from '../constants/roles.js';
import { fetchApprovalTypes, fetchMyHotels, activeStepInfo, isOverdue, ageLabel } from '../services/documents.service.js';
import { fetchDashboardDocuments, fetchMonthlyFinalized } from '../services/reports.service.js';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function renderDashboard() {
  const profile = getProfile();
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar"><div><h1>Dashboard</h1><div class="sub">Visão geral das solicitações de aprovação</div></div></div>

    <div class="filters">
      <select id="fHotel"><option value="">Todos os hotéis</option></select>
      <select id="fType"><option value="">Todos os tipos</option></select>
      <select id="fStatus">
        <option value="">Todos os status</option>
        <option value="draft">Rascunho</option>
        <option value="pending">Pendente</option>
        <option value="approved">Aprovado</option>
        <option value="rejected">Reprovado</option>
        <option value="cancelled">Cancelado</option>
        <option value="expired">Expirado</option>
      </select>
      <input type="date" id="fFrom" title="De">
      <input type="date" id="fTo" title="Até">
    </div>

    <div class="kpis">
      <div class="card kpi accent"><div class="lab">Total pendente</div><div class="val" id="kTotalPendente">—</div></div>
      <div class="card kpi"><div class="lab">Valor pendente</div><div class="val" id="kValorPendente" style="font-size:20px">—</div></div>
      <div class="card kpi"><div class="lab">Aprovados no mês</div><div class="val" id="kAprovados">—</div></div>
      <div class="card kpi"><div class="lab">Reprovados no mês</div><div class="val" id="kReprovados">—</div></div>
    </div>
    <div class="kpis" style="grid-template-columns:1fr">
      <div class="card kpi"><div class="lab">Tempo médio de ciclo (documentos finalizados no mês)</div><div class="val" id="kCiclo" style="font-size:20px">—</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="section-title"><h3>Documentos por unidade</h3></div>
        <div id="porUnidade"><div class="empty">Carregando…</div></div>
      </div>
      <div class="card">
        <div class="section-title"><h3>Pendências por aprovador</h3></div>
        <div id="porAprovador"><div class="empty">Carregando…</div></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title"><h3>Documentos parados por SLA</h3></div>
      <div id="porSla"><div class="empty">Carregando…</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title"><h3>Últimos documentos criados</h3></div>
      <table>
        <thead><tr><th>Título</th><th>Hotel</th><th>Tipo</th><th>Valor</th><th>Status</th><th>Criado em</th></tr></thead>
        <tbody id="ultimosBody"><tr><td colspan="6" class="empty">Carregando…</td></tr></tbody>
      </table>
    </div>
  `;

  const state = { hotelId: '', approvalTypeId: '', status: '', dateFrom: '', dateTo: '' };

  const hotelSelect = content.querySelector('#fHotel');
  const typeSelect = content.querySelector('#fType');
  const statusSelect = content.querySelector('#fStatus');
  const fromInput = content.querySelector('#fFrom');
  const toInput = content.querySelector('#fTo');

  function readFilters() {
    state.hotelId = hotelSelect.value;
    state.approvalTypeId = typeSelect.value;
    state.status = statusSelect.value;
    state.dateFrom = fromInput.value;
    state.dateTo = toInput.value;
  }

  [hotelSelect, typeSelect, statusSelect, fromInput, toInput].forEach((el) => {
    el.addEventListener('change', () => {
      readFilters();
      refresh();
    });
  });

  async function loadFilterOptions() {
    try {
      const [hotels, types] = await Promise.all([fetchMyHotels(profile), fetchApprovalTypes()]);
      hotelSelect.insertAdjacentHTML('beforeend', hotels.map((h) => `<option value="${h.id}">${h.name}</option>`).join(''));
      typeSelect.insertAdjacentHTML('beforeend', types.map((t) => `<option value="${t.id}">${t.name}</option>`).join(''));
      // Com um só hotel vinculado não há filtro de fato — já mostra ele
      // selecionado, em vez de "Todos os hotéis" (que aqui daria no mesmo).
      if (hotels.length === 1) {
        hotelSelect.value = hotels[0].id;
        readFilters();
      }
    } catch (err) {
      toast(`⚠ ${err.message}`);
    }
  }

  async function refresh() {
    try {
      const [docs, monthly] = await Promise.all([
        fetchDashboardDocuments(state),
        fetchMonthlyFinalized({ hotelId: state.hotelId, approvalTypeId: state.approvalTypeId }),
      ]);
      renderKpis(docs, monthly);
      renderPorUnidade(docs);
      const pendingDocs = docs.filter((d) => d.status === 'pending');
      renderPorAprovador(pendingDocs);
      renderPorSla(pendingDocs);
      renderUltimos(docs);
    } catch (err) {
      toast(`⚠ ${err.message}`);
    }
  }

  function renderKpis(docs, monthly) {
    const pendingDocs = docs.filter((d) => d.status === 'pending');
    content.querySelector('#kTotalPendente').textContent = pendingDocs.length;
    content.querySelector('#kValorPendente').textContent = fmt(pendingDocs.reduce((s, d) => s + Number(d.amount || 0), 0));
    content.querySelector('#kAprovados').textContent = monthly.filter((d) => d.status === 'approved').length;
    content.querySelector('#kReprovados').textContent = monthly.filter((d) => d.status === 'rejected').length;

    const finalized = monthly.filter((d) => d.final_decision_at);
    if (!finalized.length) {
      content.querySelector('#kCiclo').textContent = '—';
    } else {
      const avgMs = finalized.reduce((s, d) => s + (new Date(d.final_decision_at) - new Date(d.created_at)), 0) / finalized.length;
      const days = Math.floor(avgMs / 86400000);
      const hours = Math.floor((avgMs % 86400000) / 3600000);
      content.querySelector('#kCiclo').textContent = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
    }
  }

  function renderPorUnidade(docs) {
    const box = content.querySelector('#porUnidade');
    if (!docs.length) {
      box.innerHTML = '<div class="empty">Nenhum documento no filtro atual.</div>';
      return;
    }
    const byHotel = new Map();
    for (const d of docs) {
      const key = d.hotels?.name || 'Sem hotel';
      const entry = byHotel.get(key) || { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += Number(d.amount || 0);
      byHotel.set(key, entry);
    }
    const rows = [...byHotel.entries()].sort((a, b) => b[1].count - a[1].count);
    box.innerHTML = rows
      .map(
        ([name, { count, amount }]) => `
      <div class="pend-row">
        <div><b>${name}</b><span>${fmt(amount)}</span></div>
        <div class="n">${count}</div>
      </div>`
      )
      .join('');
  }

  function renderPorAprovador(pendingDocs) {
    const box = content.querySelector('#porAprovador');
    const byRole = new Map();
    for (const d of pendingDocs) {
      const info = activeStepInfo(d, d.document_approval_steps || []);
      if (!info) continue;
      const label = ROLE_LABEL[info.step.role_required] || info.step.role_required;
      const entry = byRole.get(label) || { count: 0, overdue: 0 };
      entry.count += 1;
      if (isOverdue(info.startedAt, info.step.sla_hours)) entry.overdue += 1;
      byRole.set(label, entry);
    }
    if (!byRole.size) {
      box.innerHTML = '<div class="empty">Nenhuma pendência no filtro atual.</div>';
      return;
    }
    const rows = [...byRole.entries()].sort((a, b) => b[1].count - a[1].count);
    box.innerHTML = rows
      .map(
        ([label, { count, overdue }]) => `
      <div class="pend-row">
        <div><b>${label}</b>${overdue ? `<span class="age">${overdue} atrasado${overdue > 1 ? 's' : ''}</span>` : '<span>Dentro do prazo</span>'}</div>
        <div class="n">${count}</div>
      </div>`
      )
      .join('');
  }

  function renderPorSla(pendingDocs) {
    const box = content.querySelector('#porSla');
    const overdue = pendingDocs
      .map((d) => ({ d, info: activeStepInfo(d, d.document_approval_steps || []) }))
      .filter(({ info }) => info && isOverdue(info.startedAt, info.step.sla_hours));

    if (!overdue.length) {
      box.innerHTML = '<div class="empty">Nenhum documento fora do SLA. 🎉</div>';
      return;
    }
    box.innerHTML = overdue
      .map(
        ({ d, info }) => `
      <div class="pend-row">
        <div><b>${d.title}</b><span>${d.hotels?.name || ''} · ${ROLE_LABEL[info.step.role_required] || info.step.role_required} · SLA ${info.step.sla_hours}h</span></div>
        <div class="age">${ageLabel(info.startedAt)}</div>
      </div>`
      )
      .join('');
  }

  function renderUltimos(docs) {
    const tbody = content.querySelector('#ultimosBody');
    const latest = docs.slice(0, 10);
    if (!latest.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Nenhum documento encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = latest
      .map(
        (d) => `
      <tr class="rowlink" data-id="${d.id}">
        <td class="doc-t">${d.title}</td>
        <td>${d.hotels?.name || ''}</td>
        <td>${d.approval_types?.name || ''}</td>
        <td>${fmt(d.amount)}</td>
        <td><span class="badge b-${badgeClass(d.status)}"><span class="dot"></span>${statusLabel(d.status)}</span></td>
        <td>${new Date(d.created_at).toLocaleDateString('pt-BR')}</td>
      </tr>`
      )
      .join('');
    tbody.querySelectorAll('tr.rowlink').forEach((tr) => {
      tr.addEventListener('click', () => navigate('documento', tr.dataset.id));
    });
  }

  loadFilterOptions().then(refresh);

  return renderAppLayout('dashboard', content);
}

function statusLabel(status) {
  return { draft: 'Rascunho', pending: 'Pendente', approved: 'Aprovado', rejected: 'Reprovado', cancelled: 'Cancelado', expired: 'Expirado' }[status] || status;
}

function badgeClass(status) {
  return { pending: 'wait', approved: 'ok', rejected: 'no', draft: 'draft', cancelled: 'no', expired: 'no' }[status] || 'draft';
}
