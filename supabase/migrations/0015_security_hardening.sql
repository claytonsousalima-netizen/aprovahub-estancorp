-- =====================================================================
-- AprovaHub Estancorp — Etapa 14: segurança, compliance e auditoria
-- Depende de 0001..0014 já aplicadas.
--
-- Verificação feita antes de escrever esta migração (via agente, no SQL
-- Editor): as 15 tabelas de public já têm RLS habilitada (0 sem RLS).
-- Esta migração fecha 3 lacunas reais encontradas na revisão:
--
--   1. Quatro foreign keys estavam com ON DELETE CASCADE de
--      companies/hotels para hotels/documents/audit_logs. Isso significa
--      que apagar uma empresa ou hotel apagaria em cascata TODOS os
--      documentos (aprovados, reprovados, o que fosse) e os audit_logs
--      ligados a ela — e cascata de FK não passa pela RLS de "documents"
--      nem pelo trigger de imutabilidade de "approval_evidences". Trocado
--      para ON DELETE RESTRICT: não dá mais pra apagar uma empresa/hotel
--      que tenha qualquer hotel/documento/log vinculado.
--
--   2. documents_delete permitia super_admin apagar um documento em
--      QUALQUER status, inclusive approved/rejected. Restringido pra só
--      permitir apagar rascunho (nunca submetido) — depois de enviado,
--      o único caminho é fn_cancel_document (soft delete via status),
--      que já existe desde a Etapa 9 e não altera decisão final.
--
--   3. approval_evidences já era append-only (trigger da Etapa 2).
--      audit_logs não tinha a mesma proteção — mesmo sem policy de
--      insert/update/delete pra authenticated, nada impedia um UPDATE/
--      DELETE feito por engano ou por alguém com acesso direto ao banco.
--      Acrescentado o mesmo tipo de trigger de imutabilidade.
-- =====================================================================

-- =====================================================================
-- 1. FK de companies/hotels → RESTRICT em vez de CASCADE
-- =====================================================================

alter table hotels
  drop constraint hotels_company_id_fkey,
  add constraint hotels_company_id_fkey
    foreign key (company_id) references companies(id) on delete restrict;

alter table documents
  drop constraint documents_company_id_fkey,
  add constraint documents_company_id_fkey
    foreign key (company_id) references companies(id) on delete restrict;

alter table documents
  drop constraint documents_hotel_id_fkey,
  add constraint documents_hotel_id_fkey
    foreign key (hotel_id) references hotels(id) on delete restrict;

alter table audit_logs
  drop constraint audit_logs_company_id_fkey,
  add constraint audit_logs_company_id_fkey
    foreign key (company_id) references companies(id) on delete restrict;

-- =====================================================================
-- 2. documents_delete — só rascunho, mesmo para super_admin
-- =====================================================================

drop policy if exists documents_delete on documents;

create policy documents_delete on documents for delete
  using (fn_is_super_admin() and status = 'draft');

-- =====================================================================
-- 3. audit_logs vira append-only (mesmo padrão de approval_evidences)
-- =====================================================================

create or replace function fn_prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs é append-only: % não é permitido (id %)', tg_op, old.id;
end;
$$;

drop trigger if exists trg_audit_logs_no_update on audit_logs;
create trigger trg_audit_logs_no_update
  before update on audit_logs
  for each row execute function fn_prevent_audit_log_mutation();

drop trigger if exists trg_audit_logs_no_delete on audit_logs;
create trigger trg_audit_logs_no_delete
  before delete on audit_logs
  for each row execute function fn_prevent_audit_log_mutation();
