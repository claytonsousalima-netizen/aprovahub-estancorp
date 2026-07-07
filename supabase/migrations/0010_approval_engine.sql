-- =====================================================================
-- AprovaHub Estancorp — Etapa 9: motor de aprovação (detalhe do documento)
-- Depende de 0001..0009 já aplicadas.
-- =====================================================================

-- =====================================================================
-- 1. fn_process_approval — aprova ou rejeita a etapa atual de um documento
-- SECURITY DEFINER: document_approval_steps/documents (fora do rascunho)/
-- approval_evidences/notifications/audit_logs não têm policy de escrita
-- direta pra isso, de propósito. A prova de reautenticação (senha/MFA) é
-- feita ANTES de chamar esta função, pela Edge Function "process-approval"
-- (que verifica de forma independente, não confia em flag do client) —
-- esta função só recebe o resultado já verificado e grava tudo de forma
-- atômica: decisão da etapa, avanço/fechamento do documento, evidência
-- encadeada (fn_record_evidence), certificado (se for a última etapa
-- aprovada), comentário opcional, notificações e audit_log.
-- =====================================================================

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
set search_path = public
as $$
declare
  v_doc documents%rowtype;
  v_step document_approval_steps%rowtype;
  v_next_step document_approval_steps%rowtype;
  v_evidence approval_evidences%rowtype;
  v_hash_before text;
  v_hash_after text;
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
    v_hash_before, v_hash_after
  );

  update document_approval_steps set evidence_id = v_evidence.id where id = v_step.id;

  if v_doc.status = 'approved' and v_doc.certificate_number is not null then
    perform fn_record_evidence(
      p_document_id, v_step.id, p_user_id, 'certificate_generated',
      p_ip_address, p_user_agent, p_auth_method, p_mfa_verified, p_password_reconfirmed,
      v_hash_after, v_hash_after
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

-- =====================================================================
-- 2. fn_cancel_document — cancela um rascunho ou uma solicitação pendente
-- Só o próprio solicitante ou um admin (super_admin/admin_corporativo/
-- admin_hotel do hotel do documento) pode cancelar, e só antes da decisão
-- final (draft ou pending) — depois de aprovado/rejeitado não há volta.
-- =====================================================================

create or replace function fn_cancel_document(p_document_id uuid, p_reason text)
returns documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents%rowtype;
begin
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;

  if v_doc.status not in ('draft', 'pending') then
    raise exception 'Só é possível cancelar antes da decisão final.';
  end if;

  if not (
    fn_is_super_admin()
    or (fn_is_admin_role() and v_doc.company_id = fn_my_company_id())
    or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(v_doc.hotel_id))
    or v_doc.created_by = auth.uid()
  ) then
    raise exception 'Você não tem permissão para cancelar este documento.';
  end if;

  update document_approval_steps set status = 'cancelled' where document_id = p_document_id and status = 'pending';

  update documents
  set status = 'cancelled', updated_at = now()
  where id = p_document_id
  returning * into v_doc;

  if p_reason is not null and length(trim(p_reason)) > 0 then
    insert into document_comments (document_id, user_id, comment, internal_only)
    values (p_document_id, auth.uid(), 'Cancelamento: ' || p_reason, false);
  end if;

  insert into audit_logs (company_id, actor_user_id, entity_type, entity_id, action, new_data)
  values (v_doc.company_id, auth.uid(), 'documents', p_document_id, 'cancel', to_jsonb(v_doc));

  return v_doc;
end;
$$;

revoke all on function fn_cancel_document(uuid, text) from public, anon;
grant execute on function fn_cancel_document(uuid, text) to authenticated;

-- =====================================================================
-- 3. fn_resend_approval_notification — reenvia a notificação da etapa
-- atual pendente. Restrito a admins (a mesma governança de "Reenviar
-- notificação" da Etapa 9).
-- =====================================================================

create or replace function fn_resend_approval_notification(p_document_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents%rowtype;
  v_step document_approval_steps%rowtype;
  v_assignee uuid;
  v_count integer := 0;
begin
  select * into v_doc from documents where id = p_document_id;
  if not found or v_doc.status <> 'pending' then
    raise exception 'Documento não encontrado ou não está pendente.';
  end if;

  if not (
    fn_is_super_admin()
    or (fn_is_admin_role() and v_doc.company_id = fn_my_company_id())
    or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(v_doc.hotel_id))
  ) then
    raise exception 'Apenas administradores podem reenviar notificações.';
  end if;

  select * into v_step
  from document_approval_steps
  where document_id = p_document_id and step_order = v_doc.current_step_order and status = 'pending';

  if not found then
    raise exception 'Etapa atual não encontrada.';
  end if;

  if v_step.assigned_user_id is not null then
    insert into notifications (user_id, document_id, type, title, message)
    values (v_step.assigned_user_id, p_document_id, 'approval_reminder', 'Lembrete: solicitação aguardando sua aprovação', v_doc.title);
    v_count := 1;
  else
    for v_assignee in
      select p.id from profiles p
      where p.active and p.company_id = v_doc.company_id and p.role_global = v_step.role_required
      union
      select hu.user_id from hotel_users hu
      join profiles p on p.id = hu.user_id
      where hu.active and hu.hotel_id = v_doc.hotel_id and hu.role_hotel = v_step.role_required and p.active
    loop
      insert into notifications (user_id, document_id, type, title, message)
      values (v_assignee, p_document_id, 'approval_reminder', 'Lembrete: solicitação aguardando sua aprovação', v_doc.title);
      v_count := v_count + 1;
    end loop;
  end if;

  insert into audit_logs (company_id, actor_user_id, entity_type, entity_id, action, new_data)
  values (v_doc.company_id, auth.uid(), 'documents', p_document_id, 'resend_notification', jsonb_build_object('recipients', v_count));

  return v_count;
end;
$$;

revoke all on function fn_resend_approval_notification(uuid) from public, anon;
grant execute on function fn_resend_approval_notification(uuid) to authenticated;
