import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';

export function renderAdminDashboard() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar"><div><h1>Dashboard Admin</h1><div class="sub">Visão geral dos cadastros administrativos</div></div></div>
    <div class="kpis" id="adminKpis">
      <div class="card kpi"><div class="lab">Carregando…</div></div>
    </div>
  `;

  loadCounts(content.querySelector('#adminKpis'));

  return renderAdminLayout('admin', content);
}

async function loadCounts(kpisEl) {
  const [hotels, users, rules] = await Promise.all([
    supabase.from('hotels').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('active', true),
    supabase.from('approval_rules').select('id', { count: 'exact', head: true }).eq('active', true),
  ]);

  kpisEl.innerHTML = `
    <div class="card kpi accent"><div class="lab">Hotéis</div><div class="val">${hotels.count ?? 0}</div></div>
    <div class="card kpi"><div class="lab">Usuários ativos</div><div class="val">${users.count ?? 0}</div></div>
    <div class="card kpi"><div class="lab">Regras de alçada ativas</div><div class="val">${rules.count ?? 0}</div></div>
  `;
}
