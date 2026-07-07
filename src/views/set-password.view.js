import { setNewPassword } from '../auth/auth.js';
import { reevaluateSession, markRecoveryFlowComplete } from '../auth/session.js';
import { renderAuthShell } from '../components/auth-shell.js';
import { getAssuranceLevel, listFactors, challengeAndVerify } from '../auth/mfa.js';

export function renderSetPassword() {
  const wrap = renderAuthShell(`<div id="stepContainer"></div>`);
  const container = wrap.querySelector('#stepContainer');

  renderMfaGate(container);

  return wrap;
}

// Se a conta já tem MFA configurado, o Supabase exige uma sessão AAL2 para
// trocar a senha (senão bastaria o link de e-mail pra contornar o segundo
// fator). Então, antes do formulário de senha, checamos o nível de
// autenticação atual e, se preciso, pedimos o código do autenticador aqui.
async function renderMfaGate(container) {
  let level;
  try {
    level = await getAssuranceLevel();
  } catch {
    renderPasswordStep(container);
    return;
  }

  if (!level || level.currentLevel === level.nextLevel) {
    renderPasswordStep(container);
    return;
  }

  renderMfaStep(container);
}

function renderMfaStep(container) {
  container.innerHTML = `
    <h2>Confirme sua identidade</h2>
    <p>Sua conta tem verificação em duas etapas ativa. Informe o código do seu app autenticador para poder definir uma nova senha.</p>
    <form id="mfaGateForm">
      <div class="field">
        <label>Código de 6 dígitos</label>
        <input id="fCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus>
      </div>
      <div id="msgBox" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
      <button class="btn btn-brass" type="submit" style="width:100%;justify-content:center;margin-top:16px">Verificar</button>
    </form>
  `;

  const form = container.querySelector('#mfaGateForm');
  const msgBox = container.querySelector('#msgBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = container.querySelector('#fCode').value.trim();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const { totp } = await listFactors();
      const factor = totp.find((f) => f.status === 'verified');
      if (!factor) throw new Error('Nenhum fator MFA verificado encontrado.');
      await challengeAndVerify(factor.id, code);
      renderPasswordStep(container);
    } catch {
      msgBox.textContent = 'Código inválido. Tente novamente.';
      msgBox.style.display = 'block';
      btn.disabled = false;
    }
  });
}

function renderPasswordStep(container) {
  container.innerHTML = `
    <h2>Definir senha de acesso</h2>
    <p>Escolha uma senha forte para acessar o AprovaHub: mínimo de 8 caracteres, com letra maiúscula, minúscula e número. Evite senhas óbvias ou já usadas em outros sites.</p>
    <form id="setPwForm">
      <div class="field">
        <label>Nova senha</label>
        <input type="password" id="fSenha1" minlength="8" required autocomplete="new-password">
      </div>
      <div class="field" style="margin-top:12px">
        <label>Confirmar senha</label>
        <input type="password" id="fSenha2" minlength="8" required autocomplete="new-password">
      </div>
      <div id="msgBox" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
      <button class="btn btn-brass" type="submit" style="width:100%;justify-content:center;margin-top:16px">Salvar senha e continuar</button>
    </form>
  `;

  const form = container.querySelector('#setPwForm');
  const msgBox = container.querySelector('#msgBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = container.querySelector('#fSenha1').value;
    const p2 = container.querySelector('#fSenha2').value;

    if (p1 !== p2) {
      msgBox.textContent = 'As senhas não coincidem.';
      msgBox.style.display = 'block';
      return;
    }

    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await setNewPassword(p1);
      markRecoveryFlowComplete();
      await reevaluateSession();
    } catch (err) {
      msgBox.textContent = err.message;
      msgBox.style.display = 'block';
      btn.disabled = false;
    }
  });
}
