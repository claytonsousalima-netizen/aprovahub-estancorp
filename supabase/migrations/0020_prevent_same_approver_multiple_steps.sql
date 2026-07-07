-- =====================================================================
-- AprovaHub Estancorp — segregação de funções: mesmo usuário não pode
-- aprovar/reprovar duas etapas do mesmo documento
--
-- Descoberto em produção: um usuário pode ter Papel Global (profiles.
-- role_global, vale em qualquer hotel) e Papel no Hotel (hotel_users.
-- role_hotel, vale só naquele hotel) simultaneamente. Se os dois papéis
-- baterem com etapas diferentes do fluxo de aprovação do mesmo
-- documento, fn_can_user_approve liberava as duas etapas para a mesma
-- pessoa — o que anula o propósito de exigir aprovação em múltiplos
-- níveis (segregação de funções). Ex.: usuária com role_global =
-- lider_area E hotel_users.role_hotel = lider_administrativo num hotel
-- conseguiu aprovar sozinha as etapas 1 e 2 do mesmo documento.
--
-- Fix: fn_can_user_approve agora nega a etapa atual se o usuário já
-- aprovou ou reprovou qualquer etapa anterior deste mesmo documento,
-- independente de por qual caminho (papel global, papel no hotel ou
-- atribuição direta) ele bateria com a etapa atual.
-- =====================================================================

create or replace function fn_can_user_approve(p_document_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_doc documents%rowtype;
  v_step document_approval_steps%rowtype;
  v_has_role boolean;
  v_already_decided boolean;
begin
  select * into v_doc from documents where id = p_document_id;
  if not found or v_doc.status <> 'pending' then
    return false;
  end if;

  select * into v_step from fn_next_pending_step(p_document_id);
  if v_step.id is null then
    return false;
  end if;

  select exists (
    select 1 from document_approval_steps das
    where das.document_id = p_document_id
      and das.step_order < v_step.step_order
      and (das.approved_by = p_user_id or das.rejected_by = p_user_id)
  ) into v_already_decided;

  if v_already_decided then
    return false;
  end if;

  if v_step.assigned_user_id is not null then
    return v_step.assigned_user_id = p_user_id;
  end if;

  select exists (
    select 1 from profiles p
    where p.id = p_user_id and p.active and p.role_global = v_step.role_required
  ) or exists (
    select 1 from hotel_users hu
    where hu.user_id = p_user_id and hu.hotel_id = v_doc.hotel_id
      and hu.active and hu.role_hotel = v_step.role_required
  ) into v_has_role;

  return coalesce(v_has_role, false);
end;
$$;
