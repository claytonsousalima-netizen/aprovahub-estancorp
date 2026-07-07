import { setNewPassword } from '../auth/auth.js';
import { toast } from '../components/toast.js';

export function renderChangePassword() {
  const div = document.createElement('div');
  div.className = 'main';
  div.innerHTML = `
    <div class="topbar"><div><h1>Alterar senha</h1><div class="sub">Defina uma nova senha de acesso ao portal</div></div></div>
    <div class="card" style="max-width:420px;padding:22px">
      <form id="changePwForm">
        <div class="notice">Mínimo de 8 caracteres, com pelo menos uma letra maiúscula, uma minúscula e um número. Evite senhas óbvias ou já usadas em outros sites — e, se puder, ative o MFA em <a href="#mfa-setup">Segurança</a> para uma camada extra de proteção.</div>
        <div class="field">
          <label>Nova senha</label>
          <input type="password" id="fSenha1" minlength="8" required autocomplete="new-password">
        </div>
        <div class="field" style="margin-top:12px">
          <label>Confirmar nova senha</label>
          <input type="password" id="fSenha2" minlength="8" required autocomplete="new-password">
        </div>
        <div id="msgBox" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
        <button class="btn btn-brass" type="submit" style="margin-top:16px">Salvar nova senha</button>
      </form>
    </div>
  `;

  const form = div.querySelector('#changePwForm');
  const msgBox = div.querySelector('#msgBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = div.querySelector('#fSenha1').value;
    const p2 = div.querySelector('#fSenha2').value;

    if (p1 !== p2) {
      msgBox.textContent = 'As senhas não coincidem.';
      msgBox.style.display = 'block';
      return;
    }

    msgBox.style.display = 'none';
    try {
      await setNewPassword(p1);
      toast('✅ Senha atualizada com sucesso');
      form.reset();
    } catch (err) {
      msgBox.textContent = err.message;
      msgBox.style.display = 'block';
    }
  });

  return div;
}
