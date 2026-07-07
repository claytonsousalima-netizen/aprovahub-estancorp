import { supabase } from '../config/supabase.js';

const DOC_FIELDS = '*, hotels(name, code), approval_types(name), document_approval_steps(*), creator:profiles!created_by(full_name, email)';

function applyCommonFilters(query, { hotelId, approvalTypeId, status, dateFrom, dateTo } = {}) {
  if (hotelId) query = query.eq('hotel_id', hotelId);
  if (approvalTypeId) query = query.eq('approval_type_id', approvalTypeId);
  if (status) query = query.eq('status', status);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59');
  return query;
}

// Dataset único pro dashboard: os widgets (KPIs, quebra por unidade,
// pendências por aprovador, parados por SLA, últimos criados) são todos
// derivados dele em JS, em vez de várias idas ao banco. Limite de 500 linhas
// é um teto pragmático pra esta fase — se o volume real crescer muito além
// disso, os widgets passam a valer só pros 500 mais recentes que baterem
// com o filtro, e aí um agregado feito no banco (view/RPC) passa a compensar.
export async function fetchDashboardDocuments(filters) {
  let query = supabase
    .from('documents')
    .select(DOC_FIELDS)
    .order('created_at', { ascending: false })
    .limit(500);
  query = applyCommonFilters(query, filters);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchMonthlyFinalized({ hotelId, approvalTypeId } = {}) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  let query = supabase
    .from('documents')
    .select('id, status, amount, created_at, final_decision_at, hotel_id')
    .in('status', ['approved', 'rejected'])
    .gte('final_decision_at', monthStart);
  if (hotelId) query = query.eq('hotel_id', hotelId);
  if (approvalTypeId) query = query.eq('approval_type_id', approvalTypeId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchMyPendingApprovals() {
  const { data: myDocs, error: rpcError } = await supabase.rpc('fn_my_pending_approvals');
  if (rpcError) throw new Error(rpcError.message);
  if (!myDocs || !myDocs.length) return [];

  const ids = myDocs.map((d) => d.id);
  const { data, error } = await supabase
    .from('documents')
    .select(DOC_FIELDS)
    .in('id', ids)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchArquivo(filters) {
  let query = supabase.from('documents').select(DOC_FIELDS).order('created_at', { ascending: false }).limit(500);
  query = applyCommonFilters(query, filters);

  if (filters?.minAmount) query = query.gte('amount', filters.minAmount);
  if (filters?.maxAmount) query = query.lte('amount', filters.maxAmount);
  if (filters?.supplierText) query = query.ilike('supplier_name', `%${filters.supplierText}%`);
  if (filters?.searchText) {
    const q = filters.searchText.replace(/[%,]/g, '');
    query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,supplier_name.ilike.%${q}%,cost_center.ilike.%${q}%`);
  }
  if (filters?.createdByIds?.length) query = query.in('created_by', filters.createdByIds);
  if (filters?.approverDocIds?.length) query = query.in('id', filters.approverDocIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

// "Aprovador" não é uma coluna direta de documents — resolve pra uma lista
// de document_id via document_approval_steps (aprovado/rejeitado/atribuído).
export async function findDocumentIdsByApprover(userId) {
  const { data, error } = await supabase
    .from('document_approval_steps')
    .select('document_id')
    .or(`approved_by.eq.${userId},rejected_by.eq.${userId},assigned_user_id.eq.${userId}`);
  if (error) throw new Error(error.message);
  return [...new Set((data || []).map((r) => r.document_id))];
}

export async function searchProfilesByName(nameText) {
  if (!nameText) return [];
  const { data, error } = await supabase.from('profiles').select('id, full_name, email').ilike('full_name', `%${nameText}%`).limit(20);
  if (error) throw new Error(error.message);
  return data || [];
}

const CSV_HEADERS = ['Título', 'Hotel', 'Tipo', 'Status', 'Valor', 'Fornecedor', 'Solicitante', 'Criado em', 'Certificado'];

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportDocumentsCsv(documents, filename = 'arquivo-eletronico.csv') {
  const rows = documents.map((d) => [
    d.title,
    d.hotels?.name ?? '',
    d.approval_types?.name ?? '',
    d.status,
    d.amount,
    d.supplier_name ?? '',
    d.creator?.full_name ?? '',
    new Date(d.created_at).toLocaleString('pt-BR'),
    d.certificate_number ?? '',
  ]);
  const csv = [CSV_HEADERS, ...rows].map((row) => row.map(csvEscape).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
