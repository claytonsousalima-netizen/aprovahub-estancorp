import { supabase } from '../config/supabase.js';
import { fetchMyProfile, signOut as authSignOut } from './auth.js';
import { hasVerifiedTotpFactor, getAssuranceLevel } from './mfa.js';
import { navigate } from '../routes/router.js';
import { toast } from '../components/toast.js';

let currentSession = null;
let currentProfile = null;
let pendingAuthCallbackType = null;
// "Pegajoso" (não é consumido em uma única checagem): o Supabase pode
// disparar o evento de sessão de convite/recuperação mais de uma vez
// durante o processamento do link (uma vez a partir de getSession() e de
// novo via onAuthStateChange). Se limpássemos a marcação na primeira
// checagem, a segunda rodada pulava a tela de definir senha e ia direto
// para o MFA. Fica true até o usuário realmente salvar a nova senha.
let inRecoveryFlow = false;

const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn({ session: currentSession, profile: currentProfile }));
}

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSession() {
  return currentSession;
}

export function getProfile() {
  return currentProfile;
}

export function isAuthenticated() {
  return !!currentSession;
}

export function defaultRouteForRole(role) {
  if (['lider_area', 'lider_administrativo', 'gerente_geral'].includes(role)) return 'pendentes';
  if (['admin_corporativo', 'super_admin', 'admin_hotel'].includes(role)) return 'admin';
  return 'dashboard';
}

export function markRecoveryFlowComplete() {
  inRecoveryFlow = false;
}

async function routeAfterAuth() {
  if (pendingAuthCallbackType === 'recovery' || pendingAuthCallbackType === 'invite') {
    pendingAuthCallbackType = null;
    inRecoveryFlow = true;
  }

  if (inRecoveryFlow) {
    notify();
    navigate('set-password');
    return;
  }

  currentProfile = await fetchMyProfile();

  if (!currentProfile) {
    toast('⚠ Sua conta não tem um perfil configurado. Contate o administrador.');
    await authSignOut();
    currentSession = null;
    notify();
    navigate('login');
    return;
  }

  if (!currentProfile.active) {
    toast('⛔ Sua conta está inativa. Contate o administrador.');
    await authSignOut();
    currentSession = null;
    currentProfile = null;
    notify();
    navigate('login');
    return;
  }

  if (currentProfile.mfa_required) {
    const enrolled = await hasVerifiedTotpFactor();
    if (!enrolled) {
      notify();
      navigate('mfa-setup');
      return;
    }
    const aal = await getAssuranceLevel();
    if (aal.currentLevel !== aal.nextLevel) {
      notify();
      navigate('mfa-challenge');
      return;
    }
  }

  notify();
  navigate(defaultRouteForRole(currentProfile.role_global));
}

export async function reevaluateSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  currentSession = session;
  await routeAfterAuth();
}

export async function initSession(authCallbackType) {
  pendingAuthCallbackType = authCallbackType || null;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  currentSession = session;

  if (session) {
    await routeAfterAuth();
  } else {
    notify();
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    currentSession = session;

    if (event === 'SIGNED_OUT') {
      currentProfile = null;
      notify();
      navigate('login');
      return;
    }

    // Só re-roteia em eventos de login de fato — TOKEN_REFRESHED e
    // USER_UPDATED também trazem `session` preenchida, e re-rotear nesses
    // casos arrancaria o usuário da tela atual (ex.: no meio de uma
    // assinatura) a cada renovação silenciosa de token em segundo plano.
    //
    // SIGNED_IN merece o mesmo cuidado: o próprio SDK do Supabase reemite
    // esse evento quando a aba recupera o foco (ex.: alt+tab, trocar de
    // janela), sem ser um login novo de verdade. Se já temos um perfil
    // carregado para esse mesmo usuário, é essa recuperação de foco — só
    // atualiza a sessão em memória, sem navegar pra fora da tela atual
    // (ex.: perderia o formulário de Nova solicitação em andamento).
    const isRefocusSignIn = event === 'SIGNED_IN' && session && currentProfile?.id === session.user.id;
    if (isRefocusSignIn) {
      notify();
      return;
    }

    if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && session) {
      await routeAfterAuth();
    }
  });
}

export function requireAuth(renderFn) {
  return (param) => {
    if (!isAuthenticated()) {
      navigate('login');
      return document.createElement('div');
    }
    return renderFn(param);
  };
}

export function requireRole(roles, renderFn) {
  return requireAuth((param) => {
    if (!currentProfile || !roles.includes(currentProfile.role_global)) {
      const div = document.createElement('div');
      div.className = 'empty';
      div.style.padding = '80px 20px';
      div.innerHTML = '<b>Acesso restrito</b><p>Você não tem permissão para acessar esta página.</p>';
      return div;
    }
    return renderFn(param);
  });
}
