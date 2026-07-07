import { renderAppLayout } from '../components/app-sidebar.js';
import { renderAdminLayout, ADMIN_ROLES } from '../components/admin-sidebar.js';
import { getProfile } from '../auth/session.js';
import { toast } from '../components/toast.js';
import { navigate } from '../routes/router.js';
import { fetchNotifications, markAsRead, markAllAsRead } from '../services/notifications.service.js';

const TYPE_ICON = {
  approval_pending: '⏳',
  approval_reminder: '🔔',
  approved: '✅',
  rejected: '❌',
  sla_overdue: '⚠️',
  comment_received: '💬',
  user_invited: '✉️',
};

export function renderNotificacoes() {
  const profile = getProfile();
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Notificações</h1><div class="sub">Avisos do sistema sobre suas solicitações e aprovações</div></div>
      <button class="btn btn-ghost" id="btnMarkAll">Marcar todas como lidas</button>
    </div>
    <div class="card"><div id="notifList"><div class="empty">Carregando…</div></div></div>
  `;

  const listEl = content.querySelector('#notifList');

  async function refresh() {
    try {
      const items = await fetchNotifications(profile.id);
      renderList(items);
    } catch (err) {
      listEl.innerHTML = `<div class="empty">Erro ao carregar: ${err.message}</div>`;
    }
  }

  function renderList(items) {
    if (!items.length) {
      listEl.innerHTML = '<div class="empty">Nenhuma notificação ainda.</div>';
      return;
    }

    listEl.innerHTML = items
      .map(
        (n) => `
      <div class="hist-item" data-id="${n.id}" data-doc="${n.document_id || ''}" style="cursor:pointer;${n.read_at ? '' : 'background:var(--brass-soft)'}">
        <div class="hist-ic">${TYPE_ICON[n.type] || '🔔'}</div>
        <div><b>${n.title}</b><span>${n.documents?.title || n.message || ''}</span></div>
        <div class="t">${new Date(n.created_at).toLocaleString('pt-BR')}</div>
      </div>`
      )
      .join('');

    listEl.querySelectorAll('[data-id]').forEach((row) => {
      row.addEventListener('click', async () => {
        const id = row.dataset.id;
        const docId = row.dataset.doc;
        try {
          await markAsRead(id);
        } catch {
          // não bloqueia a navegação por causa disso
        }
        if (docId) {
          navigate('documento', docId);
        } else {
          refresh();
        }
      });
    });
  }

  content.querySelector('#btnMarkAll').addEventListener('click', async () => {
    try {
      await markAllAsRead(profile.id);
      toast('✅ Notificações marcadas como lidas');
      refresh();
    } catch (err) {
      toast(`⚠ ${err.message}`);
    }
  });

  refresh();

  const layout = ADMIN_ROLES.includes(profile?.role_global) ? renderAdminLayout : renderAppLayout;
  return layout('notificacoes', content);
}
