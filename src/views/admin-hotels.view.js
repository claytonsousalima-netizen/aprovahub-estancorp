import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';
import { getProfile } from '../auth/session.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

export function renderAdminHotels() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Hotéis</h1><div class="sub">Unidades da rede cadastradas no portal</div></div>
      <button class="btn btn-brass" id="btnNewHotel">+ Novo hotel</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>Nome</th><th>Código</th><th>Status</th><th>Criado em</th><th></th></tr></thead>
      <tbody id="hotelsBody"><tr><td colspan="5" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const profile = getProfile();
  const canManage = ['super_admin', 'admin_corporativo'].includes(profile?.role_global);
  const btnNew = content.querySelector('#btnNewHotel');
  btnNew.style.display = canManage ? '' : 'none';

  const tbody = content.querySelector('#hotelsBody');
  const refresh = () => loadHotels(tbody, profile);
  btnNew.addEventListener('click', () => openHotelForm(null, profile, refresh));

  refresh();

  return renderAdminLayout('admin-hotels', content);
}

async function loadHotels(tbody, profile) {
  const { data, error } = await supabase.from('hotels').select('*').order('name');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Erro ao carregar: ${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Nenhum hotel cadastrado.</td></tr>`;
    return;
  }

  const canManage = ['super_admin', 'admin_corporativo'].includes(profile?.role_global);
  const byId = new Map(data.map((h) => [h.id, h]));

  tbody.innerHTML = data
    .map(
      (h) => `
    <tr data-id="${h.id}">
      <td><b>${h.name}</b></td>
      <td class="mono">${h.code}</td>
      <td>${
        h.active
          ? '<span class="badge b-ok"><span class="dot"></span>Ativo</span>'
          : '<span class="badge b-no"><span class="dot"></span>Inativo</span>'
      }</td>
      <td>${new Date(h.created_at).toLocaleDateString('pt-BR')}</td>
      <td>${canManage ? '<button class="btn btn-ghost btn-edit" style="padding:6px 10px">Editar</button>' : ''}</td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openHotelForm(byId.get(id), profile, () => loadHotels(tbody, profile));
    });
  });
}

function openHotelForm(hotel, profile, onSaved) {
  const isEdit = !!hotel;
  const { modal, close } = openModal(`
    <h3>${isEdit ? 'Editar hotel' : 'Novo hotel'}</h3>
    <div class="field"><label>Nome</label><input id="fName" value="${hotel?.name ?? ''}"></div>
    <div class="field" style="margin-top:12px"><label>Código</label><input id="fCode" value="${hotel?.code ?? ''}" maxlength="10" style="text-transform:uppercase"></div>
    <div class="field" style="margin-top:12px"><label><input type="checkbox" id="fActive" ${
      hotel?.active !== false ? 'checked' : ''
    }> Ativo</label></div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSave">Salvar</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSave').addEventListener('click', async () => {
    const name = modal.querySelector('#fName').value.trim();
    const code = modal.querySelector('#fCode').value.trim().toUpperCase();
    const active = modal.querySelector('#fActive').checked;
    const errorBox = modal.querySelector('#formError');

    if (!name || !code) {
      errorBox.textContent = 'Preencha nome e código.';
      errorBox.style.display = 'block';
      return;
    }

    const { error } = isEdit
      ? await supabase.from('hotels').update({ name, code, active }).eq('id', hotel.id)
      : await supabase.from('hotels').insert({ name, code, active, company_id: profile.company_id });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    close();
    toast(isEdit ? '✅ Hotel atualizado' : '✅ Hotel criado');
    onSaved();
  });
}
