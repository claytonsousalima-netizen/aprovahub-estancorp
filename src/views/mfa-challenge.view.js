import { listFactors, challengeAndVerify } from '../auth/mfa.js';
import { reevaluateSession } from '../auth/session.js';
import { signOut } from '../auth/auth.js';
import { navigate } from '../routes/router.js';
import { renderAuthShell } from '../components/auth-shell.js';

export function renderMfaChallenge() {
  const wrap = renderAuthShell(`
    <h2>Verificação em duas etapas</h2>
    <p>Informe o código gerado no seu app autenticador para concluir o login.</p>
    <form id="challengeForm">
      <div class="field">
        <label>Código de 6 dígitos</label>
        <input id="fCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus>
      </div>
      <div id="msgBox" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
      <button class="btn btn-brass" type="submit" style="width:100%;justify-content:center;margin-top:16px">Verificar</button>
    </form>
    <a id="backLink" style="display:block;margin-top:14px;font-size:12.5px;color:var(--brass);font-weight:600;text-align:center;cursor:pointer">← Usar outra conta</a>
  `);

  wrap.querySelector('#backLink').addEventListener('click', async () => {
    await signOut();
    navigate('login');
  });

  const form = wrap.querySelector('#challengeForm');
  const msgBox = wrap.querySelector('#msgBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = wrap.querySelector('#fCode').value.trim();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const { totp } = await listFactors();
      const factor = totp.find((f) => f.status === 'verified');
      if (!factor) throw new Error('Nenhum fator MFA verificado encontrado.');
      await challengeAndVerify(factor.id, code);
      await reevaluateSession();
    } catch (err) {
      msgBox.textContent = 'Código inválido. Tente novamente.';
      msgBox.style.display = 'block';
      btn.disabled = false;
    }
  });

  return wrap;
}
