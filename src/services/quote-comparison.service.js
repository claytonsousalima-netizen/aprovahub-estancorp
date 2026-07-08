import { supabase } from '../config/supabase.js';

// Linhas padrão criadas automaticamente com a primeira proposta — o
// usuário pode renomear, remover ou adicionar quantas quiser depois.
export const DEFAULT_ROW_LABELS = ['Fornecedor', 'Valor total', 'Prazo de pagamento', 'Prazo de entrega'];

export async function fetchQuoteComparison(documentId) {
  const [rowsRes, proposalsRes, valuesRes] = await Promise.all([
    supabase.from('document_quote_rows').select('*').eq('document_id', documentId).order('row_order'),
    supabase.from('document_quote_proposals').select('*, document_files(id, original_filename)').eq('document_id', documentId).order('proposal_order'),
    supabase.from('document_quote_values').select('*').eq('document_id', documentId),
  ]);
  if (rowsRes.error) throw new Error(rowsRes.error.message);
  if (proposalsRes.error) throw new Error(proposalsRes.error.message);
  if (valuesRes.error) throw new Error(valuesRes.error.message);
  return { rows: rowsRes.data || [], proposals: proposalsRes.data || [], values: valuesRes.data || [] };
}

export async function addProposal({ documentId, label, fileId, userId, hasExistingRows, proposalCount }) {
  const { data: proposal, error } = await supabase
    .from('document_quote_proposals')
    .insert({ document_id: documentId, label, file_id: fileId || null, created_by: userId, proposal_order: proposalCount + 1 })
    .select('*, document_files(id, original_filename)')
    .single();
  if (error) throw new Error(error.message);

  let newRows = [];
  if (!hasExistingRows) {
    const { data, error: rowsError } = await supabase
      .from('document_quote_rows')
      .insert(DEFAULT_ROW_LABELS.map((label, i) => ({ document_id: documentId, label, row_order: i + 1 })))
      .select();
    if (rowsError) throw new Error(rowsError.message);
    newRows = data || [];
  }

  return { proposal, newRows };
}

export async function renameProposal(proposalId, label) {
  const { error } = await supabase.from('document_quote_proposals').update({ label }).eq('id', proposalId);
  if (error) throw new Error(error.message);
}

export async function linkProposalFile(proposalId, fileId) {
  const { error } = await supabase.from('document_quote_proposals').update({ file_id: fileId || null }).eq('id', proposalId);
  if (error) throw new Error(error.message);
}

export async function removeProposal(proposalId) {
  const { error } = await supabase.from('document_quote_proposals').delete().eq('id', proposalId);
  if (error) throw new Error(error.message);
}

export async function addRow({ documentId, label, rowCount }) {
  const { data, error } = await supabase
    .from('document_quote_rows')
    .insert({ document_id: documentId, label, row_order: rowCount + 1 })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function renameRow(rowId, label) {
  const { error } = await supabase.from('document_quote_rows').update({ label }).eq('id', rowId);
  if (error) throw new Error(error.message);
}

export async function removeRow(rowId) {
  const { error } = await supabase.from('document_quote_rows').delete().eq('id', rowId);
  if (error) throw new Error(error.message);
}

export async function setCellValue({ documentId, rowId, proposalId, value }) {
  const { error } = await supabase
    .from('document_quote_values')
    .upsert({ document_id: documentId, row_id: rowId, proposal_id: proposalId, value }, { onConflict: 'row_id,proposal_id' });
  if (error) throw new Error(error.message);
}
