import { supabase } from '../config/supabase.js';
import { openReauthModal } from '../components/reauth-modal.js';

// Confirma a identidade de quem está assinando (aprovando/reprovando um
// documento) antes de liberar a ação. Retorna os campos prontos para
// approval_evidences.auth_method / mfa_verified / password_reconfirmed
// (e a senha em texto puro, só quando não há MFA — usada uma única vez
// pela Edge Function pra reconferir, nunca persistida em lugar nenhum).
export async function confirmIdentityForSignature() {
  return openReauthModal();
}

// Assina a decisão (aprovar/rejeitar) via Edge Function process-approval,
// que reconfirma a autenticação forte de forma independente do client
// antes de gravar qualquer coisa.
export async function processApproval({ documentId, decision, comment, password }) {
  const { data, error } = await supabase.functions.invoke('process-approval', {
    body: { documentId, decision, comment, password },
  });
  if (error) throw new Error(error.message || 'Erro ao processar a decisão.');
  if (data?.error) throw new Error(data.error);
  return data.document;
}

export async function cancelDocument(documentId, reason) {
  const { data, error } = await supabase.rpc('fn_cancel_document', { p_document_id: documentId, p_reason: reason || null });
  if (error) throw new Error(error.message);
  return data;
}

export async function resendApprovalNotification(documentId) {
  const { data, error } = await supabase.rpc('fn_resend_approval_notification', { p_document_id: documentId });
  if (error) throw new Error(error.message);
  return data;
}

export async function canUserApprove(documentId, userId) {
  const { data, error } = await supabase.rpc('fn_can_user_approve', { p_document_id: documentId, p_user_id: userId });
  if (error) throw new Error(error.message);
  return !!data;
}
