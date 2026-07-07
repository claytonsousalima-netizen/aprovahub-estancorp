-- =====================================================================
-- AprovaHub Estancorp — correção: recursão infinita em documents_select
-- =====================================================================
-- Bug real encontrado ao ligar Dashboard/Minhas Aprovações/Arquivo (Etapa 8):
-- toda consulta em "documents" retornava 500 (não 401 de RLS normal).
--
-- Causa: o último ramo de documents_select fazia
--   exists (select 1 from document_approval_steps das where das.document_id = documents.id and ...)
-- e a policy de SELECT de document_approval_steps é
--   exists (select 1 from documents d where d.id = document_approval_steps.document_id)
-- Ou seja: avaliar documents_select entra em document_approval_steps_select,
-- que entra de volta em documents_select — recursão infinita, detectada e
-- abortada pelo Postgres com erro (surge como 500 no PostgREST).
--
-- Correção: mover a checagem "sou aprovador/rejeitador/atribuído em alguma
-- etapa deste documento" para uma função SECURITY DEFINER (mesmo padrão já
-- usado por fn_can_user_approve etc.), que ignora RLS internamente e não
-- reentra em documents_select.
-- =====================================================================

create or replace function fn_is_document_step_participant(p_document_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from document_approval_steps das
    where das.document_id = p_document_id
      and (das.approved_by = p_user_id or das.rejected_by = p_user_id or das.assigned_user_id = p_user_id)
  );
$$;

revoke all on function fn_is_document_step_participant(uuid, uuid) from public, anon;
grant execute on function fn_is_document_step_participant(uuid, uuid) to authenticated;

drop policy if exists documents_select on documents;

create policy documents_select on documents for select
  using (
    fn_is_super_admin()
    or (company_id = fn_my_company_id() and fn_is_company_wide_viewer())
    or (company_id = fn_my_company_id() and created_by = auth.uid())
    or (company_id = fn_my_company_id() and fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_id))
    or fn_can_user_approve(id, auth.uid())
    or fn_is_document_step_participant(id, auth.uid())
  );
