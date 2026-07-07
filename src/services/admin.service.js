import { supabase } from '../config/supabase.js';

// Chama a Edge Function admin-actions, que roda com a service_role key no
// servidor — nunca no frontend. Usada só para operações que a API normal
// do Supabase não permite para um cliente comum (convidar por e-mail,
// resetar MFA de outra pessoa).
async function callAdminAction(body) {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body });
  if (error) throw new Error(error.message || 'Erro ao executar ação administrativa.');
  if (data?.error) throw new Error(data.error);
  return data;
}

export function inviteUser({ email, full_name, role_global }) {
  return callAdminAction({ type: 'invite_user', email, full_name, role_global });
}

export function createTestUser({ email, full_name, role_global, password, mfa_required, active }) {
  return callAdminAction({ type: 'create_test_user', email, full_name, role_global, password, mfa_required, active });
}

export function resetUserMfa(userId) {
  return callAdminAction({ type: 'reset_mfa', userId });
}
