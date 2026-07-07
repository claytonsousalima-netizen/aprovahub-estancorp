import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';
import { getProfile } from '../auth/session.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { inviteUser, createTestUser, resetUserMfa } from '../services/admin.service.js';
import { ROLES, ROLE_LABEL } from '../constants/roles.js';

export function renderAdminUsers() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Usuários</h1><div class="sub">Contas com acesso ao portal</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="btnCreateTest">+ Criar usuário de teste</button>
        <button class="btn btn-brass" id="btnInvite">+ Convidar usuário</button>
      </div>
    </div>
    <div class="card"><table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th>MFA</th><th></th></tr></thead>
      <tbody id="usersBody"><tr><td colspan="6" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const profile = getProfile();
  const canManage = ['super_admin', 'admin_corporativo'].includes(profile?.role_global);
  const btnInvite = content.querySelector('#btnInvite');
  const btnCreateTest = content.querySelector('#btnCreateTest');
  btnInvite.style.display = canManage ? '' : 'none';
  btnCreateTest.style.display = canManage ? '' : 'none';

  const tbody = content.querySelector('#usersBody');
  const refresh = () => loadUsers(tbody, profile);
  btnInvite.addEventListener('click', () => openInviteForm(refresh));
  btnCreateTest.addEventListener('click', () => openCreateTestUserForm(refresh));

  refresh();

  return renderAdminLayout('admin-users', content);
}

async function loadUsers(tbody, profile) {
  const { data, error } = await supabase.from('profiles').select('*').order('full_name');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Erro ao carregar: ${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum usuário encontrado.</td></tr>`;
    return;
  }

  const canManage = ['super_admin', 'admin_corporativo'].includes(profile?.role_global);
  const byId = new Map(data.map((u) => [u.id, u]));

  tbody.innerHTML = data
    .map(
      (u) => `
    <tr data-id="${u.id}">
      <td><b>${u.full_name}</b></td>
      <td class="mono">${u.email}</td>
      <td>${ROLE_LABEL[u.role_global] || u.role_global}</td>
      <td>${
        u.active
          ? '<span class="badge b-ok"><span class="dot"></span>Ativo</span>'
          : '<span class="badge b-no"><span class="dot"></span>Inativo</span>'
      }</td>
      <td>${u.mfa_required ? '<span class="badge b-wait"><span class="dot"></span>Obrigatório</span>' : '<span class="badge b-draft">Opcional</span>'}</td>
      <td>${
        canManage
          ? `<button class="btn btn-ghost btn-edit" style="padding:6px 10px">Editar</button>
             <button class="btn btn-ghost btn-reset-mfa" style="padding:6px 10px">Resetar MFA</button>`
          : ''
      }</td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openEditForm(byId.get(id), () => loadUsers(tbody, profile));
    });
  });

  tbody.querySelectorAll('.btn-reset-mfa').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const u = byId.get(id);
      if (!confirm(`Resetar o MFA de ${u.full_name}? A pessoa precisará configurar um novo app autenticador no próximo login.`)) return;
      btn.disabled = true;
      try {
        await resetUserMfa(id);
        toast(`✅ MFA de ${u.full_name} resetado`);
      } catch (err) {
        toast(`⚠ ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function openEditForm(user, onSaved) {
  const { modal, close } = openModal(`
    <h3>Editar usuário</h3>
    <div class="field"><label>Nome</label><input id="fName" value="${user.full_name}"></div>
    <div class="field" style="margin-top:12px">
      <label>Papel global</label>
      <select id="fRole">${ROLES.map(([v, l]) => `<option value="${v}" ${v === user.role_global ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="field" style="margin-top:12px"><label><input type="checkbox" id="fActive" ${user.active ? 'checked' : ''}> Ativo</label></div>
    <div class="field" style="margin-top:8px"><label><input type="checkbox" id="fMfa" ${user.mfa_required ? 'checked' : ''}> Exigir MFA</label></div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSave">Salvar</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSave').addEventListener('click', async () => {
    const full_name = modal.querySelector('#fName').value.trim();
    const role_global = modal.querySelector('#fRole').value;
    const active = modal.querySelector('#fActive').checked;
    const mfa_required = modal.querySelector('#fMfa').checked;
    const errorBox = modal.querySelector('#formError');

    if (!full_name) {
      errorBox.textContent = 'Preencha o nome.';
      errorBox.style.display = 'block';
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({ full_name, role_global, active, mfa_required })
      .eq('id', user.id);

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    close();
    toast('✅ Usuário atualizado');
    onSaved();
  });
}

function openInviteForm(onSaved) {
  const { modal, close } = openModal(`
    <h3>Convidar usuário</h3>
    <p>Um e-mail de convite será enviado. A pessoa define a própria senha e configura o MFA no primeiro acesso.</p>
    <div class="field"><label>Nome completo</label><input id="fName"></div>
    <div class="field" style="margin-top:12px"><label>E-mail</label><input type="email" id="fEmail"></div>
    <div class="field" style="margin-top:12px">
      <label>Papel global</label>
      <select id="fRole">${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    </div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSend">Enviar convite</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSend').addEventListener('click', async () => {
    const full_name = modal.querySelector('#fName').value.trim();
    const email = modal.querySelector('#fEmail').value.trim();
    const role_global = modal.querySelector('#fRole').value;
    const errorBox = modal.querySelector('#formError');
    const btn = modal.querySelector('#btnSend');

    if (!full_name || !email) {
      errorBox.textContent = 'Preencha nome e e-mail.';
      errorBox.style.display = 'block';
      return;
    }

    btn.disabled = true;
    try {
      await inviteUser({ email, full_name, role_global });
      close();
      toast(`✅ Convite enviado para ${email}`);
      onSaved();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
      btn.disabled = false;
    }
  });
}

function openCreateTestUserForm(onSaved) {
  const testRoles = ROLES.filter(([v]) => v !== 'super_admin');
  const { modal, close } = openModal(`
    <h3>Criar usuário de teste</h3>
    <p>Cria a conta já com e-mail confirmado e a senha informada, sem enviar convite por e-mail. Use só para contas de QA — não é o caminho normal de provisionamento de usuários reais.</p>
    <div class="field"><label>Nome completo</label><input id="fName"></div>
    <div class="field" style="margin-top:12px"><label>E-mail</label><input type="email" id="fEmail"></div>
    <div class="field" style="margin-top:12px"><label>Senha</label><input type="text" id="fPassword" placeholder="mínimo 8 caracteres"></div>
    <div class="field" style="margin-top:12px">
      <label>Papel global</label>
      <select id="fRole">${testRoles.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    </div>
    <div class="field" style="margin-top:8px"><label><input type="checkbox" id="fMfa" checked> Exigir MFA</label></div>
    <div class="field" style="margin-top:8px"><label><input type="checkbox" id="fActive" checked> Ativo</label></div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSend">Criar</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSend').addEventListener('click', async () => {
    const full_name = modal.querySelector('#fName').value.trim();
    const email = modal.querySelector('#fEmail').value.trim();
    const password = modal.querySelector('#fPassword').value;
    const role_global = modal.querySelector('#fRole').value;
    const mfa_required = modal.querySelector('#fMfa').checked;
    const active = modal.querySelector('#fActive').checked;
    const errorBox = modal.querySelector('#formError');
    const btn = modal.querySelector('#btnSend');

    if (!full_name || !email || !password) {
      errorBox.textContent = 'Preencha nome, e-mail e senha.';
      errorBox.style.display = 'block';
      return;
    }

    btn.disabled = true;
    try {
      await createTestUser({ email, full_name, role_global, password, mfa_required, active });
      close();
      toast(`✅ Usuário de teste ${email} criado`);
      onSaved();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
      btn.disabled = false;
    }
  });
}
