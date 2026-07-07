import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';
import { getProfile } from '../auth/session.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

export function renderAdminApprovalTypes() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Tipos de aprovação</h1><div class="sub">Categorias de documentos que passam pelo fluxo de aprovação</div></div>
      <button class="btn btn-brass" id="btnNew">+ Novo tipo</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>Código</th><th>Nome</th><th>Descrição</th><th>Status</th><th></th></tr></thead>
      <tbody id="typesBody"><tr><td colspan="5" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const profile = getProfile();
  const canManage = ['super_admin', 'admin_corporativo'].includes(profile?.role_global);
  const btnNew = content.querySelector('#btnNew');
  btnNew.style.display = canManage ? '' : 'none';

  const tbody = content.querySelector('#typesBody');
  const refresh = () => loadTypes(tbody, profile);
  btnNew.addEventListener('click', () => openForm(null, profile, refresh));

  refresh();

  return renderAdminLayout('admin-approval-types', content);
}

async function loadTypes(tbody, profile) {
  const { data, error } = await supabase.from('approval_types').select('*').order('name');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Erro ao carregar: ${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Nenhum tipo cadastrado.</td></tr>`;
    return;
  }

  const canManage = ['super_admin', 'admin_corporativo'].includes(profile?.role_global);
  const byId = new Map(data.map((t) => [t.id, t]));

  tbody.innerHTML = data
    .map(
      (t) => `
    <tr data-id="${t.id}">
      <td class="mono">${t.code}</td>
      <td><b>${t.name}</b></td>
      <td>${t.description ?? ''}</td>
      <td>${
        t.active
          ? '<span class="badge b-ok"><span class="dot"></span>Ativo</span>'
          : '<span class="badge b-no"><span class="dot"></span>Inativo</span>'
      }</td>
      <td>${canManage ? '<button class="btn btn-ghost btn-edit" style="padding:6px 10px">Editar</button>' : ''}</td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openForm(byId.get(id), profile, () => loadTypes(tbody, profile));
    });
  });
}

function openForm(type, profile, onSaved) {
  const isEdit = !!type;
  const { modal, close } = openModal(`
    <h3>${isEdit ? 'Editar tipo' : 'Novo tipo de aprovação'}</h3>
    <div class="field"><label>Código (sem espaços, ex.: cotacao)</label><input id="fCode" value="${type?.code ?? ''}"></div>
    <div class="field" style="margin-top:12px"><label>Nome</label><input id="fName" value="${type?.name ?? ''}"></div>
    <div class="field" style="margin-top:12px"><label>Descrição</label><textarea id="fDesc">${type?.description ?? ''}</textarea></div>
    <div class="field" style="margin-top:12px"><label><input type="checkbox" id="fActive" ${type?.active !== false ? 'checked' : ''}> Ativo</label></div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSave">Salvar</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSave').addEventListener('click', async () => {
    const code = modal.querySelector('#fCode').value.trim();
    const name = modal.querySelector('#fName').value.trim();
    const description = modal.querySelector('#fDesc').value.trim();
    const active = modal.querySelector('#fActive').checked;
    const errorBox = modal.querySelector('#formError');

    if (!code || !name) {
      errorBox.textContent = 'Preencha código e nome.';
      errorBox.style.display = 'block';
      return;
    }

    const { error } = isEdit
      ? await supabase.from('approval_types').update({ code, name, description, active }).eq('id', type.id)
      : await supabase.from('approval_types').insert({ code, name, description, active, company_id: profile.company_id });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    close();
    toast(isEdit ? '✅ Tipo atualizado' : '✅ Tipo criado');
    onSaved();
  });
}
