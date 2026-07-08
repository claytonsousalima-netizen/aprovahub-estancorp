import { getProfile } from '../auth/session.js';
import { navigate } from '../routes/router.js';
import { signOut } from '../auth/auth.js';
import { fetchUnreadCount } from '../services/notifications.service.js';
import { ROLE_LABEL } from '../constants/roles.js';

export const ADMIN_ROLES = ['super_admin', 'admin_corporativo', 'admin_hotel'];

const MENU = [
  { view: 'admin', label: 'Dashboard Admin' },
  { view: 'admin-companies', label: 'Empresas' },
  { view: 'admin-hotels', label: 'Hotéis' },
  { view: 'admin-users', label: 'Usuários' },
  { view: 'admin-hotel-users', label: 'Vínculo usuário x hotel' },
  { view: 'admin-roles', label: 'Perfis e permissões' },
  { view: 'admin-approval-types', label: 'Tipos de aprovação' },
  { view: 'admin-approval-rules', label: 'Regras de alçada' },
  { view: 'admin-security', label: 'Parâmetros de segurança' },
  { view: 'admin-audit-logs', label: 'Logs de auditoria' },
  { view: 'notificacoes', label: 'Notificações', badge: true },
];

export function renderAdminLayout(activeView, contentNode) {
  const profile = getProfile();
  const root = document.createElement('div');
  root.id = 'app';
  root.className = 'on';

  const aside = document.createElement('aside');
  aside.className = 'sidebar';
  aside.innerHTML = `
    <div class="side-brand">
      <div class="brand">
        <div class="brand-mark">A</div>
        <div><b>AprovaHub</b><small>Administração</small></div>
      </div>
    </div>
    <nav class="nav">
      <div class="nav-label">Cadastros</div>
      ${MENU.map(
        (m) =>
          `<button class="nav-item ${m.view === activeView ? 'active' : ''}" data-view="${m.view}">${m.label}${m.badge ? '<span class="pill" id="notifBadge" style="display:none"></span>' : ''}</button>`
      ).join('')}
    </nav>
    <div class="side-user">
      <div class="avatar" style="background:#14232E">${(profile?.full_name || '?').slice(0, 2).toUpperCase()}</div>
      <div><b>${profile?.full_name || ''}</b><span>${ROLE_LABEL[profile?.role_global] || profile?.role_global || ''}</span></div>
      <div class="side-user-actions">
        <button id="adminChangePassword" title="Alterar senha">Senha</button>
        <button id="adminLogout">Sair</button>
      </div>
    </div>
  `;

  aside.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
  aside.querySelector('#adminChangePassword').addEventListener('click', () => navigate('change-password'));
  aside.querySelector('#adminLogout').addEventListener('click', () => signOut());

  if (profile?.id) {
    fetchUnreadCount(profile.id)
      .then((count) => {
        const badge = aside.querySelector('#notifBadge');
        if (badge && count > 0) {
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.style.display = '';
        }
      })
      .catch(() => {});
  }

  const main = document.createElement('main');
  main.className = 'main';
  main.appendChild(contentNode);

  root.appendChild(aside);
  root.appendChild(main);
  return root;
}
