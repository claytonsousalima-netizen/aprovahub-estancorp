import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';
import { getProfile } from '../auth/session.js';
import { toast } from '../components/toast.js';
import { ROLES } from '../constants/roles.js';

export function renderAdminSecurity() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar"><div><h1>Parâmetros de segurança</h1><div class="sub">Exigência de MFA por perfil e visão geral da política de acesso</div></div></div>
    <div class="notice">💡 A confirmação forte (senha e/ou MFA) é sempre exigida antes de aprovar ou rejeitar um documento, independente das opções abaixo — isso é uma regra fixa do fluxo de aprovação.</div>

    <div class="card" style="padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 4px">Exigir MFA para todos os usuários de um papel</h3>
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 14px">Aplica a exigência (ou dispensa) de MFA em massa a todos os usuários com o papel selecionado. Cada usuário continua podendo ser ajustado individualmente na tela <b>Usuários</b>.</p>
      <div class="form-grid">
        <div class="field">
          <label>Papel</label>
          <select id="fRole">${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>Exigência de MFA</label>
          <select id="fRequire">
            <option value="true">Exigir MFA</option>
            <option value="false">Dispensar MFA</option>
          </select>
        </div>
      </div>
      <button class="btn btn-brass" id="btnApply" style="margin-top:14px">Aplicar ao papel</button>
      <div id="applyResult" style="font-size:12.5px;margin-top:10px"></div>
    </div>

    <div class="card" style="padding:18px">
      <h3 style="margin:0 0 4px">Política atual (Supabase Auth)</h3>
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 12px">Informativo — alterações aqui exigem acesso ao painel do Supabase (Authentication).</p>
      <div class="rule-row"><div class="rn">🔑</div><div><b>Senha mínima</b><span>8 caracteres, com letra maiúscula, minúscula e número (Authentication → Sign In / Providers → Email)</span></div></div>
      <div class="rule-row"><div class="rn">🚦</div><div><b>Rate limit de login</b><span>30 tentativas de login/cadastro a cada 5 min por IP · 150 renovações de sessão a cada 5 min por IP (Authentication → Rate Limits)</span></div></div>
      <div class="rule-row"><div class="rn">⏱️</div><div><b>Sessão</b><span>Idade máxima de 12h é aplicada na própria aprovação (process-approval); expiração/timeout de inatividade nativos do Supabase exigem plano Pro</span></div></div>
      <div class="rule-row"><div class="rn">🔐</div><div><b>MFA</b><span>Recomendado para todos os perfis que aprovam documentos, especialmente os com alçada de valores altos — ative em massa por papel acima ou oriente cada usuário a ativar em "Minha conta → Segurança"</span></div></div>
    </div>
  `;

  const profile = getProfile();
  content.querySelector('#btnApply').addEventListener('click', () => applyToRole(content, profile));

  return renderAdminLayout('admin-security', content);
}

async function applyToRole(content, profile) {
  const role_global = content.querySelector('#fRole').value;
  const mfa_required = content.querySelector('#fRequire').value === 'true';
  const btn = content.querySelector('#btnApply');
  const resultBox = content.querySelector('#applyResult');

  btn.disabled = true;
  resultBox.textContent = '';

  const { data, error } = await supabase
    .from('profiles')
    .update({ mfa_required })
    .eq('role_global', role_global)
    .select('id');

  btn.disabled = false;

  if (error) {
    resultBox.style.color = 'var(--danger)';
    resultBox.textContent = `⚠ ${error.message}`;
    return;
  }

  resultBox.style.color = 'var(--muted)';
  resultBox.textContent = `✅ Aplicado a ${data.length} usuário(s) com esse papel.`;
  toast('✅ Parâmetro de MFA atualizado');
}
