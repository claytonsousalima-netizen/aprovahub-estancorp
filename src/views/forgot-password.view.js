import { requestPasswordReset } from '../auth/auth.js';
import { renderAuthShell } from '../components/auth-shell.js';

export function renderForgotPassword() {
  const wrap = renderAuthShell(`
    <h2>Recuperar senha</h2>
    <p>Informe seu e-mail. Se ele existir em nossa base, enviaremos um link para redefinir sua senha.</p>
    <form id="forgotForm">
      <div class="field">
        <label>E-mail</label>
        <input type="email" id="fEmail" required autocomplete="username">
      </div>
      <div id="msgBox" style="font-size:12.5px;margin-top:10px;display:none"></div>
      <button class="btn btn-brass" type="submit" style="width:100%;justify-content:center;margin-top:16px">Enviar link de recuperação</button>
    </form>
    <a href="#login" style="display:block;margin-top:14px;font-size:12.5px;color:var(--brass);font-weight:600;text-align:center;text-decoration:none">← Voltar ao login</a>
  `);

  const form = wrap.querySelector('#forgotForm');
  const msgBox = wrap.querySelector('#msgBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = wrap.querySelector('#fEmail').value.trim();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await requestPasswordReset(email);
      msgBox.style.color = 'var(--ok)';
      msgBox.textContent = 'Se o e-mail existir em nossa base, um link de recuperação foi enviado.';
      msgBox.style.display = 'block';
    } catch (err) {
      msgBox.style.color = 'var(--danger)';
      msgBox.textContent = err.message;
      msgBox.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });

  return wrap;
}
