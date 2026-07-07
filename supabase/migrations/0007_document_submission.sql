-- =====================================================================
-- AprovaHub Estancorp — Etapa 7: submissão de documento (nova solicitação)
-- Depende de 0001..0006 já aplicadas.
-- =====================================================================

-- =====================================================================
-- 1. REGRA DE ALÇADA PADRÃO DA ESTANCORP (empresa inteira, qualquer tipo)
-- Só por faixa de valor, conforme especificação da Etapa 7:
--   Até R$ 3.000,00: Líder Área → Líder Administrativo
--   Acima de R$ 3.000,00: Líder Área → Líder Administrativo → Gerente Geral
-- hotel_id/approval_type_id nulos = regra genérica, usada apenas quando
-- não existir uma regra mais específica cadastrada em "Regras de alçada".
-- Idempotente: não duplica se já existir.
-- =====================================================================

do $$
declare
  v_company_id uuid;
  v_rule_id uuid;
begin
  select id into v_company_id from companies where slug = 'estancorp';
  if v_company_id is null then
    return;
  end if;

  if not exists (
    select 1 from approval_rules
    where company_id = v_company_id and hotel_id is null and approval_type_id is null and max_amount = 3000
  ) then
    insert into approval_rules (company_id, hotel_id, approval_type_id, min_amount, max_amount, requires_level_1, requires_level_2, requires_level_3, active)
    values (v_company_id, null, null, 0, 3000, true, true, false, true)
    returning id into v_rule_id;

    insert into approval_rule_steps (rule_id, step_order, role_required, approval_mode) values
      (v_rule_id, 1, 'lider_area', 'single'),
      (v_rule_id, 2, 'lider_administrativo', 'single');
  end if;

  if not exists (
    select 1 from approval_rules
    where company_id = v_company_id and hotel_id is null and approval_type_id is null and min_amount = 3000.01
  ) then
    insert into approval_rules (company_id, hotel_id, approval_type_id, min_amount, max_amount, requires_level_1, requires_level_2, requires_level_3, active)
    values (v_company_id, null, null, 3000.01, null, true, true, true, true)
    returning id into v_rule_id;

    insert into approval_rule_steps (rule_id, step_order, role_required, approval_mode) values
      (v_rule_id, 1, 'lider_area', 'single'),
      (v_rule_id, 2, 'lider_administrativo', 'single'),
      (v_rule_id, 3, 'gerente_geral', 'single');
  end if;
end $$;

-- =====================================================================
-- 2. fn_submit_document — transição draft → pending
-- SECURITY DEFINER: o client nunca grava diretamente em
-- document_approval_steps/notifications/audit_logs (sem policy de insert
-- para authenticated nessas tabelas, de propósito). Esta função concentra,
-- de forma atômica, toda a lógica de submissão:
--   - valida que o documento é rascunho do próprio usuário (ou admin)
--   - exige ao menos 1 arquivo já anexado
--   - busca a regra de alçada ativa mais específica para
--     empresa+hotel+tipo+valor (regra do banco, nunca fixa no frontend)
--   - clona as etapas da regra para document_approval_steps
--   - define current_step_order e muda status para 'pending'
--   - notifica o(s) aprovador(es) elegíveis da primeira etapa
--   - registra audit_log de criação/submissão
-- =====================================================================

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
    insert into document_approval_steps (document_id, step_order, role_required, assigned_user_id)
    values (p_document_id, v_step.step_order, v_step.role_required, v_step.required_user_id);

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
