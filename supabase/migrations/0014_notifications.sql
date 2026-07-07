-- =====================================================================
-- AprovaHub Estancorp — Etapa 13: notificações
-- Depende de 0001..0013 já aplicadas.
--
-- A tabela notifications já existe desde a Etapa 2, e fn_submit_document/
-- fn_process_approval/fn_resend_approval_notification já inserem linhas
-- nela ('approval_pending', 'approved', 'rejected', 'approval_reminder').
-- Esta migração acrescenta os dois produtores que ainda faltavam:
--   1. Notificação automática de "comentário recebido" (trigger real).
--   2. Função de "SLA vencido" — pronta pra ser chamada por um cron/Edge
--      Function agendada no futuro; não criamos o agendamento em si aqui
--      (isso é uma decisão de infraestrutura/custo que cabe ao usuário
--      ativar quando quiser), só a lógica, idempotente (não duplica
--      notificação pra quem já foi avisado da mesma etapa).
-- =====================================================================

-- =====================================================================
-- 1. Notifica o solicitante quando alguém mais comenta no documento dele.
-- Só para comentários não internos (internal_only=false) — um comentário
-- interno pode ficar invisível pro solicitante por RLS, então notificar
-- sobre algo que ele não vai conseguir ler seria confuso.
-- =====================================================================

create or replace function fn_notify_new_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents%rowtype;
begin
  if new.internal_only then
    return new;
  end if;

  select * into v_doc from documents where id = new.document_id;
  if not found or v_doc.created_by = new.user_id then
    return new;
  end if;

  insert into notifications (user_id, document_id, type, title, message)
  values (v_doc.created_by, new.document_id, 'comment_received', 'Novo comentário na sua solicitação', v_doc.title);

  return new;
end;
$$;

drop trigger if exists trg_document_comments_notify on document_comments;
create trigger trg_document_comments_notify
  after insert on document_comments
  for each row execute function fn_notify_new_comment();

-- =====================================================================
-- 2. fn_notify_overdue_steps — varre etapas pendentes com SLA estourado
-- e cria a notificação 'sla_overdue' pra quem ainda não foi avisado dessa
-- etapa específica. Restrita a super_admin (é uma varredura entre
-- empresas) — pensada pra ser chamada por um job agendado futuramente.
-- =====================================================================

create or replace function fn_notify_overdue_steps()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step record;
  v_started_at timestamptz;
  v_assignee uuid;
  v_count integer := 0;
begin
  if not fn_is_super_admin() then
    raise exception 'Apenas super_admin pode disparar essa varredura.';
  end if;

  for v_step in
    select das.*, d.company_id, d.hotel_id, d.title as document_title, d.created_at as document_created_at
    from document_approval_steps das
    join documents d on d.id = das.document_id
    where das.status = 'pending'
      and das.sla_hours is not null
      and d.status = 'pending'
      and das.step_order = d.current_step_order
  loop
    select coalesce(prev.approved_at, v_step.document_created_at)
    into v_started_at
    from document_approval_steps prev
    where prev.document_id = v_step.document_id and prev.step_order = v_step.step_order - 1;

    if v_started_at is null then
      v_started_at := v_step.document_created_at;
    end if;

    if now() <= v_started_at + (v_step.sla_hours || ' hours')::interval then
      continue;
    end if;

    if v_step.assigned_user_id is not null then
      if not exists (
        select 1 from notifications
        where document_id = v_step.document_id and user_id = v_step.assigned_user_id and type = 'sla_overdue'
      ) then
        insert into notifications (user_id, document_id, type, title, message)
        values (v_step.assigned_user_id, v_step.document_id, 'sla_overdue', 'SLA vencido: aprovação pendente', v_step.document_title);
        v_count := v_count + 1;
      end if;
    else
      for v_assignee in
        select p.id from profiles p
        where p.active and p.company_id = v_step.company_id and p.role_global = v_step.role_required
        union
        select hu.user_id from hotel_users hu
        join profiles p on p.id = hu.user_id
        where hu.active and hu.hotel_id = v_step.hotel_id and hu.role_hotel = v_step.role_required and p.active
      loop
        if not exists (
          select 1 from notifications
          where document_id = v_step.document_id and user_id = v_assignee and type = 'sla_overdue'
        ) then
          insert into notifications (user_id, document_id, type, title, message)
          values (v_assignee, v_step.document_id, 'sla_overdue', 'SLA vencido: aprovação pendente', v_step.document_title);
          v_count := v_count + 1;
        end if;
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function fn_notify_overdue_steps() from public, anon;
grant execute on function fn_notify_overdue_steps() to authenticated;
