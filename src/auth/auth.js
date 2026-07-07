import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config/supabase.js';

const ERROR_MESSAGES = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
  'User already registered': 'Este e-mail já está cadastrado.',
  'Password should be at least 6 characters': 'A senha deve ter pelo menos 6 caracteres.',
  'Password should be at least 8 characters': 'A senha deve ter pelo menos 8 caracteres.',
  'New password should be different from the old password.': 'A nova senha deve ser diferente da atual.',
  'For security purposes, you can only request this after some time.':
    'Por segurança, aguarde um pouco antes de tentar novamente.',
};

function friendlyError(error) {
  if (!error) return 'Ocorreu um erro inesperado.';
  if (error.code === 'weak_password') {
    return 'A senha não atende à política mínima: pelo menos 8 caracteres, com letra maiúscula, minúscula e número.';
  }
  return ERROR_MESSAGES[error.message] || error.message;
}

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw new Error(friendlyError(error));
}

// Reconfirma a senha do usuário logado SEM substituir a sessão atual.
// Usa o endpoint de senha do GoTrue diretamente (em vez de
// supabase.auth.signInWithPassword) porque este último trocaria a sessão
// ativa e disparia um novo evento SIGNED_IN, reiniciando o roteamento do
// app no meio de uma ação sensível (ex.: assinando uma aprovação).
export async function reconfirmPassword(password) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error('Sessão inválida.');

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ email: user.email, password }),
  });

  if (!res.ok) throw new Error('Senha incorreta.');
}

export async function setNewPassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(friendlyError(error));
}

export async function fetchMyProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw new Error(friendlyError(error));
  return data;
}
