import { getProfile } from '../auth/session.js';
import { navigate } from '../routes/router.js';
import { signOut } from '../auth/auth.js';
import { fetchUnreadCount } from '../services/notifications.service.js';
import { ROLE_LABEL } from '../constants/roles.js';

const MENU = [
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'nova-solicitacao', label: 'Nova solicitação' },
  { view: 'pendentes', label: 'Minhas aprovações' },
  { view: 'arquivo', label: 'Arquivo eletrônico' },
  { view: 'notificacoes', label: 'Notificações', badge: true },
];

export function renderAppLayout(activeView, contentNode) {
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
        <div><b>AprovaHub</b><small>Estancorp</small></div>
      </div>
    </div>
    <nav class="nav">
      <div class="nav-label">Aprovações</div>
      ${MENU.map(
        (m) =>
          `<button class="nav-item ${m.view === activeView ? 'active' : ''}" data-view="${m.view}">${m.label}${m.badge ? '<span class="pill" id="notifBadge" style="display:none"></span>' : ''}</button>`
      ).join('')}
    </nav>
    <div class="side-user">
      <div class="side-user-top">
        <div class="avatar" style="background:#14232E">${(profile?.full_name || '?').slice(0, 2).toUpperCase()}</div>
        <div><b>${profile?.full_name || ''}</b><span>${ROLE_LABEL[profile?.role_global] || profile?.role_global || ''}</span></div>
      </div>
      <div class="side-user-actions">
        <button id="appChangePassword" title="Alterar senha">Senha</button>
        <button id="appLogout">Sair</button>
      </div>
    </div>
  `;

  aside.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
  aside.querySelector('#appChangePassword').addEventListener('click', () => navigate('change-password'));
  aside.querySelector('#appLogout').addEventListener('click', () => signOut());

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
