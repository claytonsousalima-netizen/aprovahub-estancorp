-- =====================================================================
-- AprovaHub Estancorp — Etapa 8: Dashboard, Minhas Aprovações, Arquivo
-- Depende de 0001..0007 já aplicadas.
-- =====================================================================

-- =====================================================================
-- 1. SLA por etapa do documento
-- document_approval_steps não guardava o SLA (só a regra-modelo em
-- approval_rule_steps guardava). Sem isso, não dá pra saber, depois que o
-- documento já foi criado, se uma etapa estourou o prazo. Copiamos o SLA
-- da regra no momento da submissão (fn_submit_document), junto com o resto.
-- =====================================================================

alter table document_approval_steps add column if not exists sla_hours integer;

create or replace function fn_submit_document(p_document_id uuid)
returns documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents%rowtype;
  v_rule approval_rules%rowtype;
  v_step approval_rule_steps%rowtype;
  v_first_step approval_rule_steps%rowtype;
  v_first_step_order integer;
  v_file_count integer;
  v_assignee uuid;
begin
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;

  if v_doc.status <> 'draft' then
    raise exception 'Este documento já foi enviado para aprovação.';
  end if;

  if not (
    fn_is_super_admin()
    or (v_doc.created_by = auth.uid() and v_doc.company_id = fn_my_company_id())
    or (fn_is_admin_role() and v_doc.company_id = fn_my_company_id())
  ) then
    raise exception 'Você não tem permissão para enviar este documento.';
  end if;

  select count(*) into v_file_count from document_files where document_id = p_document_id;
  if v_file_count = 0 then
    raise exception 'Anexe ao menos um arquivo antes de enviar a solicitação.';
  end if;

  select *
  into v_rule
  from approval_rules
  where company_id = v_doc.company_id
    and active
    and (hotel_id is null or hotel_id = v_doc.hotel_id)
    and (approval_type_id is null or approval_type_id = v_doc.approval_type_id)
    and min_amount <= v_doc.amount
    and (max_amount is null or v_doc.amount <= max_amount)
  order by (hotel_id is not null) desc, (approval_type_id is not null) desc, min_amount desc
  limit 1;

  if not found then
    raise exception 'Nenhuma regra de alçada ativa cobre este hotel/tipo/valor. Contate o administrador.';
  end if;

  v_first_step_order := null;

  for v_step in
    select * from approval_rule_steps
    where rule_id = v_rule.id and active
    order by step_order
  loop
    insert into document_approval_steps (document_id, step_order, role_required, assigned_user_id, sla_hours)
    values (p_document_id, v_step.step_order, v_step.role_required, v_step.required_user_id, v_step.sla_hours);

    if v_first_step_order is null then
      v_first_step_order := v_step.step_order;
      v_first_step := v_step;
    end if;
  end loop;

  if v_first_step_order is null then
    raise exception 'A regra de alçada encontrada não tem etapas configuradas.';
  end if;

  update documents
  set status = 'pending', current_step_order = v_first_step_order
  where id = p_document_id
  returning * into v_doc;

  if v_first_step.required_user_id is not null then
    insert into notifications (user_id, document_id, type, title, message)
    values (v_first_step.required_user_id, p_document_id, 'approval_pending', 'Nova solicitação aguardando sua aprovação', v_doc.title);
  else
    for v_assignee in
      select p.id
      from profiles p
      where p.active and p.company_id = v_doc.company_id and p.role_global = v_first_step.role_required
      union
      select hu.user_id
      from hotel_users hu
      join profiles p on p.id = hu.user_id
      where hu.active and hu.hotel_id = v_doc.hotel_id and hu.role_hotel = v_first_step.role_required and p.active
    loop
      insert into notifications (user_id, document_id, type, title, message)
      values (v_assignee, p_document_id, 'approval_pending', 'Nova solicitação aguardando sua aprovação', v_doc.title);
    end loop;
  end if;

  insert into audit_logs (company_id, actor_user_id, entity_type, entity_id, action, new_data)
  values (v_doc.company_id, auth.uid(), 'documents', p_document_id, 'submit', to_jsonb(v_doc));

  return v_doc;
end;
$$;

revoke all on function fn_submit_document(uuid) from public, anon;
grant execute on function fn_submit_document(uuid) to authenticated;

-- =====================================================================
-- 2. fn_my_pending_approvals — base da tela "Minhas Aprovações"
-- Reaproveita fn_can_user_approve (já usada pela policy de UPDATE de
-- document_approval_steps) para garantir a MESMA regra de "aprovador da
-- etapa atual" tanto aqui quanto na hora de efetivamente aprovar/rejeitar.
-- Isso evita qualquer duplicação/drift da lógica de autorização no
-- frontend — a tela só lista o que essa função (já confiável) devolve.
-- =====================================================================

create or replace function fn_my_pending_approvals()
returns setof documents
language sql
stable
security definer
set search_path = public
as $$
  select d.*
  from documents d
  where d.status = 'pending'
    and fn_can_user_approve(d.id, auth.uid());
$$;

revoke all on function fn_my_pending_approvals() from public, anon;
grant execute on function fn_my_pending_approvals() to authenticated;
