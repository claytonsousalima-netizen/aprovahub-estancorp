import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';
import { getProfile } from '../auth/session.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

export function renderAdminCompanies() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Empresas</h1><div class="sub">Cadastro da(s) empresa(s) do portal</div></div>
      <button class="btn btn-brass" id="btnNewCompany">+ Nova empresa</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>Nome</th><th>Slug</th><th>Status</th><th>Criada em</th><th></th></tr></thead>
      <tbody id="companiesBody"><tr><td colspan="5" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const profile = getProfile();
  const canCreate = profile?.role_global === 'super_admin';
  const btnNew = content.querySelector('#btnNewCompany');
  btnNew.style.display = canCreate ? '' : 'none';

  const tbody = content.querySelector('#companiesBody');
  const refresh = () => loadCompanies(tbody, profile);
  btnNew.addEventListener('click', () => openCompanyForm(null, refresh));

  refresh();

  return renderAdminLayout('admin-companies', content);
}

async function loadCompanies(tbody, profile) {
  const { data, error } = await supabase.from('companies').select('*').order('name');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Erro ao carregar: ${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Nenhuma empresa encontrada.</td></tr>`;
    return;
  }

  const canEdit = ['super_admin', 'admin_corporativo'].includes(profile?.role_global);
  const byId = new Map(data.map((c) => [c.id, c]));

  tbody.innerHTML = data
    .map(
      (c) => `
    <tr data-id="${c.id}">
      <td><b>${c.name}</b></td>
      <td class="mono">${c.slug}</td>
      <td>${
        c.active
          ? '<span class="badge b-ok"><span class="dot"></span>Ativa</span>'
          : '<span class="badge b-no"><span class="dot"></span>Inativa</span>'
      }</td>
      <td>${new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
      <td>${canEdit ? '<button class="btn btn-ghost btn-edit" style="padding:6px 10px">Editar</button>' : ''}</td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openCompanyForm(byId.get(id), () => loadCompanies(tbody, profile));
    });
  });
}

function openCompanyForm(company, onSaved) {
  const isEdit = !!company;
  const { modal, close } = openModal(`
    <h3>${isEdit ? 'Editar empresa' : 'Nova empresa'}</h3>
    <div class="field"><label>Nome</label><input id="fName" value="${company?.name ?? ''}"></div>
    <div class="field" style="margin-top:12px"><label>Slug</label><input id="fSlug" value="${company?.slug ?? ''}"></div>
    <div class="field" style="margin-top:12px"><label><input type="checkbox" id="fActive" ${
      company?.active !== false ? 'checked' : ''
    }> Ativa</label></div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSave">Salvar</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSave').addEventListener('click', async () => {
    const name = modal.querySelector('#fName').value.trim();
    const slug = modal.querySelector('#fSlug').value.trim();
    const active = modal.querySelector('#fActive').checked;
    const errorBox = modal.querySelector('#formError');

    if (!name || !slug) {
      errorBox.textContent = 'Preencha nome e slug.';
      errorBox.style.display = 'block';
      return;
    }

    const { error } = isEdit
      ? await supabase.from('companies').update({ name, slug, active }).eq('id', company.id)
      : await supabase.from('companies').insert({ name, slug, active });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    close();
    toast(isEdit ? '✅ Empresa atualizada' : '✅ Empresa criada');
    onSaved();
  });
}
