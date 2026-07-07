import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';
import { openModal } from '../components/modal.js';

const ACTION_LABEL = { insert: 'Criação', update: 'Alteração', delete: 'Exclusão' };

export function renderAdminAuditLogs() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Logs de auditoria</h1><div class="sub">Histórico de alterações administrativas (últimos 200 registros)</div></div>
    </div>
    <div class="card" style="padding:14px 18px;margin-bottom:14px">
      <div class="form-grid">
        <div class="field">
          <label>Tabela</label>
          <select id="fEntity">
            <option value="">Todas</option>
            <option value="companies">Empresas</option>
            <option value="hotels">Hotéis</option>
            <option value="profiles">Usuários</option>
            <option value="hotel_users">Vínculo usuário x hotel</option>
            <option value="approval_types">Tipos de aprovação</option>
            <option value="approval_rules">Regras de alçada</option>
            <option value="approval_rule_steps">Etapas de alçada</option>
          </select>
        </div>
        <div class="field">
          <label>Ação</label>
          <select id="fAction">
            <option value="">Todas</option>
            <option value="insert">Criação</option>
            <option value="update">Alteração</option>
            <option value="delete">Exclusão</option>
          </select>
        </div>
      </div>
    </div>
    <div class="card"><table>
      <thead><tr><th>Data/hora</th><th>Tabela</th><th>Ação</th><th>Ator</th><th></th></tr></thead>
      <tbody id="logsBody"><tr><td colspan="5" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const tbody = content.querySelector('#logsBody');
  const refresh = () => loadLogs(tbody, content);
  content.querySelector('#fEntity').addEventListener('change', refresh);
  content.querySelector('#fAction').addEventListener('change', refresh);

  refresh();

  return renderAdminLayout('admin-audit-logs', content);
}

async function loadLogs(tbody, content) {
  const entity = content.querySelector('#fEntity').value;
  const action = content.querySelector('#fAction').value;

  let query = supabase
    .from('audit_logs')
    .select('*, profiles(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (entity) query = query.eq('entity_type', entity);
  if (action) query = query.eq('action', action);

  const { data, error } = await query;

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Erro ao carregar: ${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Nenhum registro encontrado.</td></tr>`;
    return;
  }

  const byId = new Map(data.map((l) => [l.id, l]));

  tbody.innerHTML = data
    .map(
      (l) => `
    <tr data-id="${l.id}">
      <td class="mono" style="font-size:12px">${new Date(l.created_at).toLocaleString('pt-BR')}</td>
      <td>${l.entity_type}</td>
      <td>${ACTION_LABEL[l.action] || l.action}</td>
      <td>${l.profiles?.full_name ?? '<i style="color:var(--muted)">sistema</i>'}</td>
      <td><button class="btn btn-ghost btn-details" style="padding:6px 10px">Ver detalhes</button></td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-details').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openDetails(byId.get(id));
    });
  });
}

function openDetails(log) {
  const { modal, close } = openModal(`
    <h3>Detalhes do registro</h3>
    <p style="font-size:12.5px;color:var(--muted)">
      ${new Date(log.created_at).toLocaleString('pt-BR')} · ${log.entity_type} · ${ACTION_LABEL[log.action] || log.action}
      ${log.profiles?.full_name ? ` · por ${log.profiles.full_name}` : ''}
    </p>
    ${log.old_data ? `<label style="font-size:12.5px;font-weight:700">Antes</label><pre class="mono" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;overflow:auto;max-height:200px">${escapeHtml(JSON.stringify(log.old_data, null, 2))}</pre>` : ''}
    ${log.new_data ? `<label style="font-size:12.5px;font-weight:700">Depois</label><pre class="mono" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;overflow:auto;max-height:200px">${escapeHtml(JSON.stringify(log.new_data, null, 2))}</pre>` : ''}
    <div class="modal-actions"><button class="btn btn-ghost" id="btnClose">Fechar</button></div>
  `);
  modal.querySelector('#btnClose').addEventListener('click', close);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
