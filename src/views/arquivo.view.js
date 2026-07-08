import { renderAppLayout } from '../components/app-sidebar.js';
import { getProfile } from '../auth/session.js';
import { toast } from '../components/toast.js';
import { navigate } from '../routes/router.js';
import { fetchApprovalTypes, fetchMyHotels } from '../services/documents.service.js';
import { fetchArquivo, findDocumentIdsByApprover, searchProfilesByName, exportDocumentsCsv } from '../services/reports.service.js';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Solicitante só enxerga os próprios documentos por RLS de qualquer forma;
// a exportação em massa fica reservada pra quem já tem visão da empresa/hotel.
const CAN_EXPORT_ROLES = ['super_admin', 'admin_corporativo', 'admin_hotel', 'financeiro', 'auditor', 'juridico'];

export function renderArquivo() {
  const profile = getProfile();
  const canExport = CAN_EXPORT_ROLES.includes(profile?.role_global);

  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Arquivo eletrônico</h1><div class="sub">Todos os documentos que você tem permissão de ver</div></div>
      ${canExport ? '<button class="btn btn-ghost" id="btnExport">Exportar CSV</button>' : ''}
    </div>

    <div class="filters">
      <input type="text" id="fSearch" placeholder="Buscar por título, descrição, fornecedor…" style="min-width:260px">
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
      <input type="text" id="fSupplier" placeholder="Fornecedor">
      <input type="number" id="fMin" placeholder="Valor mín.">
      <input type="number" id="fMax" placeholder="Valor máx.">
      <input type="date" id="fFrom" title="De">
      <input type="date" id="fTo" title="Até">
      <input type="text" id="fSolicitante" placeholder="Solicitante">
      <input type="text" id="fAprovador" placeholder="Aprovador">
    </div>

    <div class="card"><table>
      <thead><tr><th>Título</th><th>Hotel</th><th>Tipo</th><th>Valor</th><th>Status</th><th>Solicitante</th><th>Criado em</th><th></th></tr></thead>
      <tbody id="arqBody"><tr><td colspan="8" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const tbody = content.querySelector('#arqBody');
  let lastResults = [];

  const fields = {
    search: content.querySelector('#fSearch'),
    hotel: content.querySelector('#fHotel'),
    type: content.querySelector('#fType'),
    status: content.querySelector('#fStatus'),
    supplier: content.querySelector('#fSupplier'),
    min: content.querySelector('#fMin'),
    max: content.querySelector('#fMax'),
    from: content.querySelector('#fFrom'),
    to: content.querySelector('#fTo'),
    solicitante: content.querySelector('#fSolicitante'),
    aprovador: content.querySelector('#fAprovador'),
  };

  let debounceTimer;
  Object.values(fields).forEach((el) => {
    const eventName = el.type === 'text' || el.type === 'number' ? 'input' : 'change';
    el.addEventListener(eventName, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refresh, 350);
    });
  });

  async function loadFilterOptions() {
    try {
      const [hotels, types] = await Promise.all([fetchMyHotels(profile), fetchApprovalTypes()]);
      fields.hotel.insertAdjacentHTML('beforeend', hotels.map((h) => `<option value="${h.id}">${h.name}</option>`).join(''));
      fields.type.insertAdjacentHTML('beforeend', types.map((t) => `<option value="${t.id}">${t.name}</option>`).join(''));
      // Com um só hotel vinculado não há filtro de fato — já mostra ele
      // selecionado, em vez de "Todos os hotéis" (que aqui daria no mesmo).
      if (hotels.length === 1) fields.hotel.value = hotels[0].id;
    } catch (err) {
      toast(`⚠ ${err.message}`);
    }
  }

  async function refresh() {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Buscando…</td></tr>';
    try {
      let createdByIds;
      if (fields.solicitante.value.trim()) {
        const matches = await searchProfilesByName(fields.solicitante.value.trim());
        createdByIds = matches.map((p) => p.id);
        if (!createdByIds.length) {
          lastResults = [];
          tbody.innerHTML = '<tr><td colspan="8" class="empty">Nenhum solicitante encontrado com esse nome.</td></tr>';
          return;
        }
      }

      let approverDocIds;
      if (fields.aprovador.value.trim()) {
        const matches = await searchProfilesByName(fields.aprovador.value.trim());
        const ids = matches.map((p) => p.id);
        if (!ids.length) {
          lastResults = [];
          tbody.innerHTML = '<tr><td colspan="8" class="empty">Nenhum aprovador encontrado com esse nome.</td></tr>';
          return;
        }
        const idSets = await Promise.all(ids.map((id) => findDocumentIdsByApprover(id)));
        approverDocIds = [...new Set(idSets.flat())];
        if (!approverDocIds.length) {
          lastResults = [];
          tbody.innerHTML = '<tr><td colspan="8" class="empty">Nenhum documento encontrado para esse aprovador.</td></tr>';
          return;
        }
      }

      const docs = await fetchArquivo({
        hotelId: fields.hotel.value,
        approvalTypeId: fields.type.value,
        status: fields.status.value,
        dateFrom: fields.from.value,
        dateTo: fields.to.value,
        supplierText: fields.supplier.value.trim(),
        minAmount: fields.min.value ? parseFloat(fields.min.value) : null,
        maxAmount: fields.max.value ? parseFloat(fields.max.value) : null,
        searchText: fields.search.value.trim(),
        createdByIds,
        approverDocIds,
      });

      lastResults = docs;
      renderList(docs);
    } catch (err) {
      lastResults = [];
      tbody.innerHTML = `<tr><td colspan="8" class="empty">Erro ao carregar: ${err.message}</td></tr>`;
    }
  }

  function renderList(docs) {
    if (!docs.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Nenhum documento encontrado com esses filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = docs
      .map(
        (d) => `
      <tr>
        <td class="doc-t">${d.title}</td>
        <td>${d.hotels?.name || ''}</td>
        <td>${d.approval_types?.name || ''}</td>
        <td>${fmt(d.amount)}</td>
        <td><span class="badge b-${badgeClass(d.status)}"><span class="dot"></span>${statusLabel(d.status)}</span></td>
        <td>${d.creator?.full_name || ''}</td>
        <td>${new Date(d.created_at).toLocaleDateString('pt-BR')}</td>
        <td><button class="btn btn-ghost btn-open" data-id="${d.id}" style="padding:6px 10px">Abrir</button></td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('.btn-open').forEach((btn) => {
      btn.addEventListener('click', () => navigate('documento', btn.dataset.id));
    });
  }

  if (canExport) {
    content.querySelector('#btnExport').addEventListener('click', () => {
      if (!lastResults.length) {
        toast('⚠ Não há documentos para exportar com os filtros atuais.');
        return;
      }
      exportDocumentsCsv(lastResults);
    });
  }

  loadFilterOptions().then(refresh);

  return renderAppLayout('arquivo', content);
}

function statusLabel(status) {
  return { draft: 'Rascunho', pending: 'Pendente', approved: 'Aprovado', rejected: 'Reprovado', cancelled: 'Cancelado', expired: 'Expirado' }[status] || status;
}

function badgeClass(status) {
  return { pending: 'wait', approved: 'ok', rejected: 'no', draft: 'draft', cancelled: 'no', expired: 'no' }[status] || 'draft';
}
