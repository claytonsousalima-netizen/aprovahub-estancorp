import { supabase } from '../config/supabase.js';

const DETAIL_FIELDS = `
  *,
  companies(name),
  hotels(name, code),
  approval_types(name),
  creator:profiles!created_by(full_name, email),
  document_files(*),
  document_approval_steps(
    *,
    assignee:profiles!assigned_user_id(full_name),
    approver:profiles!approved_by(full_name),
    rejecter:profiles!rejected_by(full_name)
  ),
  document_comments(*, profiles(full_name)),
  approval_evidences(*, profiles(full_name))
`;

export async function fetchDocumentDetail(documentId) {
  const { data, error } = await supabase.from('documents').select(DETAIL_FIELDS).eq('id', documentId).single();
  if (error) throw new Error(error.message);
  return data;
}

// Só admin corporativo/jurídico (e super admin) enxergam audit_logs (RLS).
// Para os demais papéis, tratamos isso como "seção indisponível", não erro.
export async function fetchAuditLogs(documentId) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*, profiles(full_name)')
    .eq('entity_type', 'documents')
    .eq('entity_id', documentId)
    .order('created_at', { ascending: false });
  if (error) return null;
  return data;
}

export async function addComment(documentId, userId, comment) {
  const { error } = await supabase.from('document_comments').insert({ document_id: documentId, user_id: userId, comment, internal_only: false });
  if (error) throw new Error(error.message);
}

const SIGNED_URL_EXPIRES_IN = 60; // segundos — só o suficiente pra completar o download
const PREVIEW_URL_EXPIRES_IN = 600; // segundos — dá tempo de ler o documento na tela

// createSignedUrl() já passa pela RLS de storage.objects com o token de
// quem chamou: só quem enxerga o documento (mesma regra de sempre)
// consegue gerar a URL assinada. Nunca expomos os buckets como públicos
// nem fazemos download direto sem essa checagem.
export async function getSignedFileUrl(file, expiresIn = SIGNED_URL_EXPIRES_IN) {
  const { data, error } = await supabase.storage.from(file.storage_bucket).createSignedUrl(file.storage_path, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function recordFileAccessEvidence({ documentId, userId, action }) {
  // Evidência de baixo risco (view/download): a própria RLS de
  // approval_evidences só permite essas duas ações via insert direto do
  // client — approve/reject/certificate_generated exigem a Edge Function.
  const { error } = await supabase.from('approval_evidences').insert({
    document_id: documentId,
    user_id: userId,
    action,
  });
  if (error) throw new Error(error.message);
}

export async function downloadDocumentFile(file, { documentId, userId } = {}) {
  const signedUrl = await getSignedFileUrl(file);

  if (documentId && userId) {
    try {
      await recordFileAccessEvidence({ documentId, userId, action: 'download' });
    } catch {
      // Não bloqueia o download por causa da evidência — só registra quando dá.
    }
  }

  const a = document.createElement('a');
  a.href = signedUrl;
  a.download = file.original_filename;
  a.rel = 'noopener';
  a.click();
}

const PREVIEWABLE_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

export function isPreviewable(file) {
  return PREVIEWABLE_MIME_TYPES.has(file.mime_type);
}

// URL de vida mais longa que a de download, só pra exibir na tela (iframe/img).
export async function getPreviewFileUrl(file, { documentId, userId } = {}) {
  const signedUrl = await getSignedFileUrl(file, PREVIEW_URL_EXPIRES_IN);

  if (documentId && userId) {
    try {
      await recordFileAccessEvidence({ documentId, userId, action: 'view' });
    } catch {
      // Não bloqueia a visualização por causa da evidência — só registra quando dá.
    }
  }

  return signedUrl;
}
