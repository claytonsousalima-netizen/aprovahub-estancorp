import { getProfile } from '../auth/session.js';
import { reconfirmPassword } from '../auth/auth.js';
import { listFactors, challengeAndVerify } from '../auth/mfa.js';

// Reautenticação antes de uma assinatura (aprovar/reprovar documento).
// Se a conta exige MFA, o desafio TOTP já é uma prova forte de identidade
// e é usado sozinho (authMethod 'totp_mfa'). Caso contrário, exige senha
// (authMethod 'password_reconfirmation'). Resolve com os campos prontos
// para alimentar approval_evidences (auth_method / mfa_verified /
// password_reconfirmed) quando a etapa de assinatura for implementada.
export function openReauthModal({ title = 'Confirmar identidade para assinatura', description } = {}) {
  const profile = getProfile();
  const useMfa = !!profile?.mfa_required;

  return new Promise((resolve, reject) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg on';
    bg.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        <p>${
          description ||
          (useMfa
            ? 'Informe o código do seu app autenticador para registrar esta assinatura eletrônica.'
            : 'Confirme sua senha para registrar esta assinatura eletrônica.')
        }</p>
        ${
          useMfa
            ? `<div class="field"><label>Código MFA (6 dígitos)</label><input id="reauthCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autofocus></div>`
            : `<div class="field"><label>Senha</label><input type="password" id="reauthPassword" autocomplete="current-password" autofocus></div>`
        }
        <div id="reauthError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="reauthCancel">Cancelar</button>
          <button class="btn btn-ok" id="reauthConfirm" disabled>✓ Confirmar identidade</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    const input = bg.querySelector(useMfa ? '#reauthCode' : '#reauthPassword');
    const confirmBtn = bg.querySelector('#reauthConfirm');
    const errorBox = bg.querySelector('#reauthError');

    function updateButtonState() {
      confirmBtn.disabled = useMfa ? !/^\d{6}$/.test(input.value) : input.value.length === 0;
    }
    input.addEventListener('input', updateButtonState);

    function close() {
      bg.remove();
    }

    bg.querySelector('#reauthCancel').addEventListener('click', () => {
      close();
      reject(new Error('cancelled'));
    });

    confirmBtn.addEventListener('click', async () => {
      errorBox.style.display = 'none';
      confirmBtn.disabled = true;
      try {
        if (useMfa) {
          const { totp } = await listFactors();
          const factor = totp.find((f) => f.status === 'verified');
          if (!factor) throw new Error('Nenhum fator MFA verificado encontrado.');
          await challengeAndVerify(factor.id, input.value.trim());
          close();
          // A verificação de MFA acima já eleva a sessão atual para AAL2 de
          // verdade (claim assinada pelo próprio Supabase) — quem for gravar
          // a assinatura deve reconferir isso no token, não confiar neste
          // valor local. Ele só existe para preencher approval_evidences.
          resolve({ passwordReconfirmed: false, mfaVerified: true, authMethod: 'totp_mfa' });
        } else {
          await reconfirmPassword(input.value);
          close();
          // Sem MFA não existe um claim de sessão pra provar a reconfirmação;
          // por isso devolvemos a senha também, para quem for gravar a
          // assinatura poder reconferi-la de forma independente (nunca
          // persistida — usada uma única vez e descartada).
          resolve({ passwordReconfirmed: true, mfaVerified: false, authMethod: 'password_reconfirmation', password: input.value });
        }
      } catch (err) {
        errorBox.textContent = err.message || 'Não foi possível confirmar sua identidade.';
        errorBox.style.display = 'block';
        updateButtonState();
      }
    });

    input.focus();
  });
}
