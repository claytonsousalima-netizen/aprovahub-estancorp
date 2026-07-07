import { enrollTotp, challengeAndVerify } from '../auth/mfa.js';
import { reevaluateSession, getProfile } from '../auth/session.js';
import { renderAuthShell } from '../components/auth-shell.js';

export function renderMfaSetup() {
  const profile = getProfile();
  const intro = profile?.mfa_required
    ? 'Sua conta exige um segundo fator de autenticação. Escaneie o QR code com um app autenticador (Google Authenticator, Authy, 1Password etc.) e informe o código gerado.'
    : 'Ativar a verificação em duas etapas é opcional para sua conta, mas recomendado: com o MFA ativo, suas aprovações passam a ser confirmadas por um código do app autenticador em vez de apenas a senha. Escaneie o QR code abaixo e informe o código gerado para ativar.';
  const wrap = renderAuthShell(`
    <h2>Configurar verificação em duas etapas</h2>
    <p>${intro}</p>
    <div id="qrBox" style="text-align:center;margin-bottom:16px;color:var(--muted);font-size:12.5px">Gerando QR code...</div>
    <form id="mfaForm">
      <div class="field">
        <label>Código de 6 dígitos</label>
        <input id="fCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required>
      </div>
      <div id="msgBox" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
      <button class="btn btn-brass" type="submit" style="width:100%;justify-content:center;margin-top:16px">Confirmar e ativar</button>
    </form>
  `);

  let factorId = null;
  const qrBox = wrap.querySelector('#qrBox');

  enrollTotp()
    .then(({ id, totp }) => {
      factorId = id;
      qrBox.innerHTML = `
        <img src="${totp.qr_code}" alt="QR code de configuração do MFA" style="width:180px;height:180px">
        <div class="mono" style="font-size:10.5px;color:var(--muted);margin-top:8px;word-break:break-all">${totp.secret}</div>
      `;
    })
    .catch((err) => {
      qrBox.innerHTML = `<p style="color:var(--danger);font-size:12.5px">Erro ao iniciar configuração: ${err.message}</p>`;
    });

  const form = wrap.querySelector('#mfaForm');
  const msgBox = wrap.querySelector('#msgBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!factorId) return;
    const code = wrap.querySelector('#fCode').value.trim();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await challengeAndVerify(factorId, code);
      await reevaluateSession();
    } catch (err) {
      msgBox.textContent = 'Código inválido. Verifique o app autenticador e tente novamente.';
      msgBox.style.display = 'block';
      btn.disabled = false;
    }
  });

  return wrap;
}
