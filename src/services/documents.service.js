import { supabase } from '../config/supabase.js';

export const ALLOWED_EXTENSIONS = ['pdf', 'xls', 'xlsx', 'doc', 'docx', 'png', 'jpg', 'jpeg'];

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]);

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function validateFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Tipo não permitido: .${ext || '?'}. Use PDF, XLS, XLSX, DOC, DOCX, PNG, JPG ou JPEG.`;
  }
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return `Tipo de arquivo não permitido (${file.type}).`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `Arquivo maior que ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`;
  }
  return null;
}

export async function sha256Hex(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sanitizeFilename(name) {
  return name.normalize('NFKD').replace(/[^\w.\-]+/g, '_');
}

export async function fetchApprovalTypes() {
  const { data, error } = await supabase.from('approval_types').select('*').eq('active', true).order('name');
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchMyHotels(profile) {
  if (['super_admin', 'admin_corporativo'].includes(profile?.role_global)) {
    const { data, error } = await supabase.from('hotels').select('id, name, code').eq('active', true).order('name');
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase
    .from('hotel_users')
    .select('hotels(id, name, code)')
    .eq('user_id', profile.id)
    .eq('active', true);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.hotels).filter(Boolean);
}

// Prévia informativa da rota de aprovação (empresa+hotel+tipo+valor); a
// decisão real e vinculante é recalculada pelo banco em fn_submit_document.
export async function previewApprovalRoute({ companyId, hotelId, approvalTypeId, amount }) {
  if (!companyId || !hotelId || !approvalTypeId || !(amount > 0)) return null;

  const { data: rules, error } = await supabase
    .from('approval_rules')
    .select('*, approval_rule_steps(*)')
    .eq('company_id', companyId)
    .eq('active', true)
    .or(`hotel_id.is.null,hotel_id.eq.${hotelId}`)
    .or(`approval_type_id.is.null,approval_type_id.eq.${approvalTypeId}`)
    .lte('min_amount', amount);

  if (error) throw new Error(error.message);

  const eligible = (rules || []).filter((r) => r.max_amount == null || amount <= r.max_amount);
  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    const spec = (r) => (r.hotel_id ? 2 : 0) + (r.approval_type_id ? 1 : 0);
    const diff = spec(b) - spec(a);
    return diff !== 0 ? diff : b.min_amount - a.min_amount;
  });

  const rule = eligible[0];
  const steps = (rule.approval_rule_steps || []).filter((s) => s.active).sort((a, b) => a.step_order - b.step_order);
  return { rule, steps };
}

export async function createDraftDocument({ companyId, hotelId, approvalTypeId, title, description, supplierName, costCenter, amount, createdBy }) {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      company_id: companyId,
      hotel_id: hotelId,
      approval_type_id: approvalTypeId,
      title,
      description: description || null,
      supplier_name: supplierName || null,
      cost_center: costCenter || null,
      amount,
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export const DOCUMENT_FILES_BUCKET = 'document-files';

// Convenção de path exigida: company_id/hotel_id/document_id/NN-arquivo.
export async function uploadDocumentFile({ document, file, order, userId }) {
  const file_sha256 = await sha256Hex(file);
  const path = `${document.company_id}/${document.hotel_id}/${document.id}/${String(order).padStart(2, '0')}-${sanitizeFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_FILES_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const { error: dbError } = await supabase.from('document_files').insert({
    document_id: document.id,
    storage_bucket: DOCUMENT_FILES_BUCKET,
    storage_path: path,
    original_filename: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    file_sha256,
    file_order: order,
    uploaded_by: userId,
  });
  if (dbError) throw new Error(dbError.message);
}

export async function addInternalNote({ documentId, userId, comment }) {
  const { error } = await supabase.from('document_comments').insert({
    document_id: documentId,
    user_id: userId,
    comment,
    internal_only: true,
  });
  if (error) throw new Error(error.message);
}

export async function submitDocument(documentId) {
  const { data, error } = await supabase.rpc('fn_submit_document', { p_document_id: documentId });
  if (error) throw new Error(error.message);
  return data;
}

// A etapa "ativa" de um documento é a que bate com current_step_order.
// Como todas as etapas são criadas de uma vez na submissão (fn_submit_document),
// document_approval_steps.created_at é igual pra todas — não serve pra medir
// desde quando UMA etapa específica está esperando. O início real da etapa N é
// a criação do documento (se N=1) ou o approved_at da etapa N-1 (se N>1).
export function activeStepInfo(document, steps) {
  const current = (steps || []).find((s) => s.step_order === document.current_step_order);
  if (!current) return null;
  const prev = (steps || []).find((s) => s.step_order === current.step_order - 1);
  const startedAt = current.step_order === 1 ? document.created_at : prev?.approved_at || document.created_at;
  return { step: current, startedAt };
}

export function isOverdue(startedAt, slaHours) {
  if (!slaHours || !startedAt) return false;
  const deadline = new Date(startedAt).getTime() + slaHours * 3600 * 1000;
  return Date.now() > deadline;
}

export function ageLabel(startedAt) {
  if (!startedAt) return '—';
  const ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}
