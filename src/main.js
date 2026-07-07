import { registerView, startRouter } from './routes/router.js';
import { initSession, requireAuth, requireRole } from './auth/session.js';
import { toast } from './components/toast.js';
import { ADMIN_ROLES } from './components/admin-sidebar.js';
import { renderLogin } from './views/login.view.js';
import { renderForgotPassword } from './views/forgot-password.view.js';
import { renderSetPassword } from './views/set-password.view.js';
import { renderChangePassword } from './views/change-password.view.js';
import { renderMfaSetup } from './views/mfa-setup.view.js';
import { renderMfaChallenge } from './views/mfa-challenge.view.js';
import { renderAdminDashboard } from './views/admin-dashboard.view.js';
import { renderAdminCompanies } from './views/admin-companies.view.js';
import { renderAdminHotels } from './views/admin-hotels.view.js';
import { renderAdminUsers } from './views/admin-users.view.js';
import { renderAdminHotelUsers } from './views/admin-hotel-users.view.js';
import { renderAdminApprovalTypes } from './views/admin-approval-types.view.js';
import { renderAdminApprovalRules } from './views/admin-approval-rules.view.js';
import { renderAdminRoles } from './views/admin-roles.view.js';
import { renderAdminSecurity } from './views/admin-security.view.js';
import { renderAdminAuditLogs } from './views/admin-audit-logs.view.js';
import { renderNovaSolicitacao } from './views/nova-solicitacao.view.js';
import { renderDashboard } from './views/dashboard.view.js';
import { renderPendentes } from './views/pendentes.view.js';
import { renderArquivo } from './views/arquivo.view.js';
import { renderDocumento } from './views/documento.view.js';
import { renderNotificacoes } from './views/notificacoes.view.js';

// Links de convite/recuperação do Supabase chegam como
// "#access_token=...&type=recovery|invite&...", ou, se o link expirou/já
// foi usado, como "#error=access_denied&error_code=otp_expired&...".
// Capturamos isso aqui, de forma síncrona, antes que o próprio SDK
// processe e limpe a URL.
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const authCallbackType = hashParams.get('type');
const authCallbackErrorCode = hashParams.get('error_code') || hashParams.get('error');

const AUTH_LINK_ERROR_MESSAGES = {
  otp_expired: 'O link do e-mail expirou. Peça um novo convite ou uma nova recuperação de senha.',
  access_denied: 'O link do e-mail é inválido ou já foi utilizado.',
};

if (authCallbackErrorCode) {
  // Limpa a URL antes do router renderizar, para não mostrar o erro cru do Supabase.
  history.replaceState(null, '', location.pathname + location.search + '#login');
}

registerView('login', renderLogin);
registerView('forgot-password', renderForgotPassword);
registerView('set-password', renderSetPassword);
registerView('change-password', requireAuth(renderChangePassword));
registerView('mfa-setup', requireAuth(renderMfaSetup));
registerView('mfa-challenge', requireAuth(renderMfaChallenge));

registerView('admin', requireRole(ADMIN_ROLES, renderAdminDashboard));
registerView('admin-companies', requireRole(ADMIN_ROLES, renderAdminCompanies));
registerView('admin-hotels', requireRole(ADMIN_ROLES, renderAdminHotels));
registerView('admin-users', requireRole(ADMIN_ROLES, renderAdminUsers));
registerView('admin-hotel-users', requireRole(ADMIN_ROLES, renderAdminHotelUsers));
registerView('admin-roles', requireRole(ADMIN_ROLES, renderAdminRoles));
registerView('admin-approval-types', requireRole(ADMIN_ROLES, renderAdminApprovalTypes));
registerView('admin-approval-rules', requireRole(ADMIN_ROLES, renderAdminApprovalRules));
registerView('admin-security', requireRole(ADMIN_ROLES, renderAdminSecurity));
registerView('admin-audit-logs', requireRole(ADMIN_ROLES, renderAdminAuditLogs));

registerView('nova-solicitacao', requireAuth(renderNovaSolicitacao));
registerView('dashboard', requireAuth(renderDashboard));
registerView('pendentes', requireAuth(renderPendentes));
registerView('arquivo', requireAuth(renderArquivo));
registerView('documento', requireAuth(renderDocumento));
registerView('notificacoes', requireAuth(renderNotificacoes));

startRouter();

if (authCallbackErrorCode) {
  toast('⚠ ' + (AUTH_LINK_ERROR_MESSAGES[authCallbackErrorCode] || 'O link do e-mail é inválido ou expirou.'));
}

initSession(authCallbackType);

// Rede de segurança: se por algum motivo o link de convite/recuperação
// não for processado (token inválido, evento inesperado do SDK etc.), o
// usuário não deve ficar preso numa tela de "processando" para sempre.
if (authCallbackType && (location.hash.includes('access_token=') || location.hash.includes('type='))) {
  setTimeout(() => {
    if (location.hash.includes('access_token=') || location.hash.includes('type=')) {
      toast('⚠ Não foi possível processar o link automaticamente. Peça um novo link e tente novamente.');
      history.replaceState(null, '', location.pathname + location.search + '#login');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }, 6000);
}
