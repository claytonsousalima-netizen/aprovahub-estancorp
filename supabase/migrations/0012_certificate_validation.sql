-- =====================================================================
-- AprovaHub Estancorp — Etapa 11: validação pública de certificado
-- Depende de 0001..0011 já aplicadas.
--
-- Única função de todo o sistema com EXECUTE liberado para `anon` — de
-- propósito, e bem estreita: devolve só um JSON com os "dados mínimos" do
-- certificado (sem valor, fornecedor, solicitante, IP ou comentários),
-- e só quando o documento já está 'approved' com certificate_number
-- gerado. Nenhuma tabela ganha grant novo para anon — o acesso continua
-- só através desta função, com o formato de saída controlado aqui dentro.
-- =====================================================================

create or replace function fn_validate_certificate(p_certificate_number text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'company_name', c.name,
    'hotel_name', h.name,
    'document_title', d.title,
    'approval_type_name', t.name,
    'certificate_number', d.certificate_number,
    'status', d.status,
    'created_at', d.created_at,
    'final_decision_at', d.final_decision_at,
    'final_hash', d.final_hash,
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'step_order', das.step_order,
        'role_required', das.role_required,
        'approver_name', p.full_name,
        'approved_at', das.approved_at,
        'auth_method', ev.auth_method,
        'mfa_verified', ev.mfa_verified
      ) order by das.step_order), '[]'::jsonb)
      from document_approval_steps das
      left join profiles p on p.id = das.approved_by
      left join approval_evidences ev on ev.id = das.evidence_id
      where das.document_id = d.id and das.status = 'approved'
    )
  )
  from documents d
  join companies c on c.id = d.company_id
  join hotels h on h.id = d.hotel_id
  join approval_types t on t.id = d.approval_type_id
  where d.certificate_number = p_certificate_number and d.status = 'approved';
$$;

revoke all on function fn_validate_certificate(text) from public;
grant execute on function fn_validate_certificate(text) to anon, authenticated;
