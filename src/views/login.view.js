import { signInWithPassword } from '../auth/auth.js';
import { isAuthenticated, getProfile, defaultRouteForRole } from '../auth/session.js';
import { navigate } from '../routes/router.js';
import { renderAuthShell } from '../components/auth-shell.js';

export function renderLogin() {
  if (isAuthenticated() && getProfile()) {
    navigate(defaultRouteForRole(getProfile().role_global));
    return document.createElement('div');
  }

  const wrap = renderAuthShell(`
    <h2>Entrar no portal</h2>
    <p>Use seu e-mail e senha corporativos Estancorp.</p>
    <form id="loginForm">
      <div class="field">
        <label>E-mail</label>
        <input type="email" id="fEmail" required autocomplete="username">
      </div>
      <div class="field" style="margin-top:12px">
        <label>Senha</label>
        <input type="password" id="fSenha" required autocomplete="current-password">
      </div>
      <div id="loginError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
      <button class="btn btn-brass" type="submit" style="width:100%;justify-content:center;margin-top:16px">Entrar</button>
    </form>
    <a href="#forgot-password" style="display:block;margin-top:14px;font-size:12.5px;color:var(--brass);font-weight:600;text-align:center;text-decoration:none">Esqueci minha senha</a>
  `);

  const form = wrap.querySelector('#loginForm');
  const errorBox = wrap.querySelector('#loginError');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    const email = wrap.querySelector('#fEmail').value.trim();
    const senha = wrap.querySelector('#fSenha').value;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await signInWithPassword(email, senha);
      // O redirecionamento pós-login acontece via onAuthStateChange em session.js
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
      btn.disabled = false;
    }
  });

  return wrap;
}
