-- =====================================================================
-- AprovaHub Estancorp — correção: digest() não encontrado por causa do
-- search_path restrito
--
-- Erro ao aprovar/reprovar pela primeira vez de verdade (depois das
-- correções de GRANT em 0017/0018): "function digest(text, unknown)
-- does not exist". Causa: neste projeto a extensão pgcrypto está
-- instalada no schema "extensions" (confirmado via pg_extension), não
-- em "public". fn_process_approval e fn_chain_evidence_hash chamam
-- digest() sem qualificar o schema, e como são funções com
-- "set search_path = public" (hardening deliberado contra injeção de
-- search_path em funções SECURITY DEFINER — não dá pra simplesmente
-- tirar essa restrição), o Postgres não enxerga extensions.digest.
--
-- Nunca foi pego antes porque nenhuma aprovação real tinha passado
-- pelas Edge Functions até as correções de GRANT desta sessão — todo
-- teste anterior rodava a lógica de aprovação via SQL Editor/RPC direto
-- como "postgres", que aí sim tem "extensions" no search_path padrão.
-- =====================================================================

create or replace function fn_chain_evidence_hash()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_prev_hash text;
  v_payload text;
begin
  select evidence_hash into v_prev_hash
  from approval_evidences
  where document_id = new.document_id
  order by created_at desc, id desc
  limit 1;

  new.previous_evidence_hash := v_prev_hash;
  new.action_at := coalesce(new.action_at, now());

  v_payload := coalesce(new.document_id::text,'') || '|' ||
               coalesce(new.approval_step_id::text,'') || '|' ||
               coalesce(new.user_id::text,'') || '|' ||
               coalesce(new.action::text,'') || '|' ||
               new.action_at::text || '|' ||
               coalesce(new.ip_address::text,'') || '|' ||
               coalesce(new.document_hash_before,'') || '|' ||
               coalesce(new.document_hash_after,'') || '|' ||
               coalesce(new.user_email,'') || '|' ||
               coalesce(new.user_role,'') || '|' ||
               coalesce(new.files_hash,'') || '|' ||
               coalesce(new.rejection_reason,'') || '|' ||
               coalesce(v_prev_hash, 'GENESIS');

  new.evidence_hash := encode(digest(v_payload, 'sha256'), 'hex');

  return new;
end;
$$;

create or replace function fn_process_approval(
  p_document_id uuid,
  p_user_id uuid,
  p_decision text,
  p_comment text,
  p_auth_method text,
  p_mfa_verified boolean,
  p_password_reconfirmed boolean,
  p_ip_address inet,
  p_user_agent text
)
returns documents
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_doc documents%rowtype;
  v_step document_approval_steps%rowtype;
  v_next_step document_approval_steps%rowtype;
  v_evidence approval_evidences%rowtype;
  v_hash_before text;
  v_hash_after text;
  v_files_hash text;
  v_user_email text;
  v_user_role text;
  v_rejection_reason text;
  v_assignee uuid;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decisão inválida.';
  end if;

  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
  if v_doc.status <> 'pending' then
    raise exception 'Este documento não está mais pendente de aprovação.';
  end if;

  if not fn_can_user_approve(p_document_id, p_user_id) then
    raise exception 'Você não pode aprovar ou rejeitar esta etapa agora.';
  end if;

  select email, role_global::text into v_user_email, v_user_role
  from profiles where id = p_user_id;

  select encode(digest(coalesce(string_agg(file_sha256, '|' order by file_order), ''), 'sha256'), 'hex')
  into v_files_hash
  from document_files
  where document_id = p_document_id;

  select * into v_step
  from document_approval_steps
  where document_id = p_document_id and step_order = v_doc.current_step_order
  for update;

  if not found or v_step.status <> 'pending' then
    raise exception 'Etapa atual não encontrada ou já decidida.';
  end if;

  v_hash_before := encode(digest(to_jsonb(v_doc)::text, 'sha256'), 'hex');

  if p_decision = 'approve' then
    update document_approval_steps
    set status = 'approved', approved_by = p_user_id, approved_at = now()
    where id = v_step.id;

    select * into v_next_step
    from document_approval_steps
    where document_id = p_document_id and step_order > v_doc.current_step_order
    order by step_order asc
    limit 1;

    if found then
      update documents
      set current_step_order = v_next_step.step_order, updated_at = now()
      where id = p_document_id
      returning * into v_doc;

      if v_next_step.assigned_user_id is not null then
        insert into notifications (user_id, document_id, type, title, message)
        values (v_next_step.assigned_user_id, p_document_id, 'approval_pending', 'Nova etapa aguardando sua aprovação', v_doc.title);
      else
        for v_assignee in
          select p.id from profiles p
          where p.active and p.company_id = v_doc.company_id and p.role_global = v_next_step.role_required
          union
          select hu.user_id from hotel_users hu
          join profiles p on p.id = hu.user_id
          where hu.active and hu.hotel_id = v_doc.hotel_id and hu.role_hotel = v_next_step.role_required and p.active
        loop
          insert into notifications (user_id, document_id, type, title, message)
          values (v_assignee, p_document_id, 'approval_pending', 'Nova etapa aguardando sua aprovação', v_doc.title);
        end loop;
      end if;
    else
      update documents
      set status = 'approved',
          final_decision_at = now(),
          certificate_number = fn_generate_certificate_number(),
          updated_at = now()
      where id = p_document_id
      returning * into v_doc;

      insert into notifications (user_id, document_id, type, title, message)
      values (v_doc.created_by, p_document_id, 'approved', 'Solicitação aprovada', v_doc.title);
    end if;
  else
    v_rejection_reason := p_comment;

    update document_approval_steps
    set status = 'rejected', rejected_by = p_user_id, rejected_at = now(), rejection_reason = p_comment
    where id = v_step.id;

    update document_approval_steps
    set status = 'cancelled'
    where document_id = p_document_id and status = 'pending';

    update documents
    set status = 'rejected', final_decision_at = now(), updated_at = now()
    where id = p_document_id
    returning * into v_doc;

    insert into notifications (user_id, document_id, type, title, message)
    values (v_doc.created_by, p_document_id, 'rejected', 'Solicitação reprovada', v_doc.title);
  end if;

  v_hash_after := encode(digest(to_jsonb(v_doc)::text, 'sha256'), 'hex');

  if v_doc.status = 'approved' then
    update documents set final_hash = v_hash_after where id = p_document_id;
    v_doc.final_hash := v_hash_after;
  end if;

  v_evidence := fn_record_evidence(
    p_document_id, v_step.id, p_user_id,
    case when p_decision = 'approve' then 'approve'::evidence_action else 'reject'::evidence_action end,
    p_ip_address, p_user_agent, p_auth_method, p_mfa_verified, p_password_reconfirmed,
    v_hash_before, v_hash_after,
    v_user_email, v_user_role, v_files_hash, v_rejection_reason
  );

  update document_approval_steps set evidence_id = v_evidence.id where id = v_step.id;

  if v_doc.status = 'approved' and v_doc.certificate_number is not null then
    perform fn_record_evidence(
      p_document_id, v_step.id, p_user_id, 'certificate_generated',
      p_ip_address, p_user_agent, p_auth_method, p_mfa_verified, p_password_reconfirmed,
      v_hash_after, v_hash_after,
      v_user_email, v_user_role, v_files_hash, null
    );
  end if;

  if p_comment is not null and length(trim(p_comment)) > 0 then
    insert into document_comments (document_id, user_id, comment, internal_only)
    values (p_document_id, p_user_id, p_comment, false);
  end if;

  insert into audit_logs (company_id, actor_user_id, entity_type, entity_id, action, new_data)
  values (v_doc.company_id, p_user_id, 'documents', p_document_id, p_decision, to_jsonb(v_doc));

  return v_doc;
end;
$$;

revoke all on function fn_process_approval(uuid, uuid, text, text, text, boolean, boolean, inet, text) from public, anon, authenticated;
grant execute on function fn_process_approval(uuid, uuid, text, text, text, boolean, boolean, inet, text) to service_role;
