import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';
import { getProfile } from '../auth/session.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { ROLES, ROLE_LABEL } from '../constants/roles.js';

export function renderAdminHotelUsers() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Vínculo usuário x hotel</h1><div class="sub">Quem tem acesso a cada unidade e com qual papel</div></div>
      <button class="btn btn-brass" id="btnNewLink">+ Vincular usuário</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>Usuário</th><th>Hotel</th><th>Papel no hotel</th><th>Status</th><th></th></tr></thead>
      <tbody id="linksBody"><tr><td colspan="5" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const profile = getProfile();
  const btnNew = content.querySelector('#btnNewLink');
  const tbody = content.querySelector('#linksBody');
  const refresh = () => loadLinks(tbody, profile);
  btnNew.addEventListener('click', () => openLinkForm(profile, refresh));

  refresh();

  return renderAdminLayout('admin-hotel-users', content);
}

async function loadLinks(tbody, profile) {
  const { data, error } = await supabase
    .from('hotel_users')
    .select('id, role_hotel, active, hotels(name, code), profiles(full_name, email)')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Erro ao carregar: ${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Nenhum vínculo cadastrado.</td></tr>`;
    return;
  }

  const byId = new Map(data.map((l) => [l.id, l]));

  tbody.innerHTML = data
    .map(
      (l) => `
    <tr data-id="${l.id}">
      <td><b>${l.profiles?.full_name ?? '—'}</b><div class="doc-s">${l.profiles?.email ?? ''}</div></td>
      <td>${l.hotels?.name ?? '—'} <span class="mono" style="color:var(--muted)">${l.hotels?.code ?? ''}</span></td>
      <td>${ROLE_LABEL[l.role_hotel] || l.role_hotel}</td>
      <td>${
        l.active
          ? '<span class="badge b-ok"><span class="dot"></span>Ativo</span>'
          : '<span class="badge b-no"><span class="dot"></span>Inativo</span>'
      }</td>
      <td>
        <button class="btn btn-ghost btn-edit" style="padding:6px 10px">Editar</button>
        <button class="btn btn-ghost btn-remove" style="padding:6px 10px;color:var(--danger)">Remover</button>
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openEditForm(byId.get(id), () => loadLinks(tbody, profile));
    });
  });

  tbody.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const link = byId.get(id);
      if (!confirm(`Remover o acesso de ${link.profiles?.full_name} ao hotel ${link.hotels?.name}?`)) return;
      const { error } = await supabase.from('hotel_users').delete().eq('id', id);
      if (error) {
        toast(`⚠ ${error.message}`);
        return;
      }
      toast('✅ Vínculo removido');
      loadLinks(tbody, profile);
    });
  });
}

async function fetchManageableHotels(profile) {
  if (['super_admin', 'admin_corporativo'].includes(profile?.role_global)) {
    const { data } = await supabase.from('hotels').select('id, name, code').order('name');
    return data || [];
  }
  // admin_hotel só gerencia vínculos dos hotéis aos quais já tem acesso.
  const { data } = await supabase
    .from('hotel_users')
    .select('hotels(id, name, code)')
    .eq('user_id', profile.id)
    .eq('active', true);
  return (data || []).map((r) => r.hotels).filter(Boolean);
}

function openEditForm(link, onSaved) {
  const { modal, close } = openModal(`
    <h3>Editar vínculo</h3>
    <p>${link.profiles?.full_name} · ${link.hotels?.name}</p>
    <div class="field">
      <label>Papel no hotel</label>
      <select id="fRole">${ROLES.map(([v, l]) => `<option value="${v}" ${v === link.role_hotel ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="field" style="margin-top:12px"><label><input type="checkbox" id="fActive" ${link.active ? 'checked' : ''}> Ativo</label></div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSave">Salvar</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSave').addEventListener('click', async () => {
    const role_hotel = modal.querySelector('#fRole').value;
    const active = modal.querySelector('#fActive').checked;
    const { error } = await supabase.from('hotel_users').update({ role_hotel, active }).eq('id', link.id);
    if (error) {
      const errorBox = modal.querySelector('#formError');
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }
    close();
    toast('✅ Vínculo atualizado');
    onSaved();
  });
}

async function openLinkForm(profile, onSaved) {
  const [hotels, usersResult] = await Promise.all([
    fetchManageableHotels(profile),
    supabase.from('profiles').select('id, full_name, email').order('full_name'),
  ]);
  const users = usersResult.data || [];

  if (!hotels.length) {
    toast('⚠ Você não tem hotéis para gerenciar vínculos.');
    return;
  }

  const { modal, close } = openModal(`
    <h3>Vincular usuário a um hotel</h3>
    <div class="field">
      <label>Usuário</label>
      <select id="fUser">${users.map((u) => `<option value="${u.id}">${u.full_name} · ${u.email}</option>`).join('')}</select>
    </div>
    <div class="field" style="margin-top:12px">
      <label>Hotel</label>
      <select id="fHotel">${hotels.map((h) => `<option value="${h.id}">${h.name} (${h.code})</option>`).join('')}</select>
    </div>
    <div class="field" style="margin-top:12px">
      <label>Papel no hotel</label>
      <select id="fRole">${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    </div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSave">Vincular</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSave').addEventListener('click', async () => {
    const user_id = modal.querySelector('#fUser').value;
    const hotel_id = modal.querySelector('#fHotel').value;
    const role_hotel = modal.querySelector('#fRole').value;
    const errorBox = modal.querySelector('#formError');

    const { error } = await supabase.from('hotel_users').insert({ user_id, hotel_id, role_hotel });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    close();
    toast('✅ Vínculo criado');
    onSaved();
  });
}
