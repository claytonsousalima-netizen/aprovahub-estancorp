-- =====================================================================
-- AprovaHub Estancorp — Etapa 3: Row Level Security (policies)
-- Execute depois de 0001_initial_schema.sql (e opcionalmente 0002).
-- Ainda NÃO depende de haver usuários reais logados: pode ser rodado
-- imediatamente. Antes de haver perfis, todas as tabelas continuam
-- inacessíveis via anon/authenticated (fail-closed), exatamente como
-- ficaram ao final da Etapa 2 — este script apenas adiciona as regras.
-- =====================================================================

-- =====================================================================
-- 1. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO
-- Todas SECURITY DEFINER + search_path fixo: podem ser chamadas de
-- dentro de policies sem recursão de RLS nas tabelas profiles/hotel_users.
-- =====================================================================

create or replace function fn_my_company_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select company_id from profiles where id = auth.uid();
$$;

create or replace function fn_my_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role_global from profiles where id = auth.uid();
$$;

create or replace function fn_is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role_global = 'super_admin' from profiles where id = auth.uid()), false);
$$;

-- admin_corporativo ou super_admin: administram cadastros da empresa inteira
create or replace function fn_is_admin_role()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role_global in ('super_admin','admin_corporativo') from profiles where id = auth.uid()), false);
$$;

-- papéis que enxergam todos os documentos da empresa, sem vínculo de hotel
create or replace function fn_is_company_wide_viewer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role_global in ('admin_corporativo','financeiro','auditor','juridico') from profiles where id = auth.uid()), false);
$$;

create or replace function fn_my_hotel_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select hotel_id from hotel_users where user_id = auth.uid() and active;
$$;

create or replace function fn_has_hotel_access(p_hotel_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from hotel_users
    where user_id = auth.uid() and hotel_id = p_hotel_id and active
  );
$$;

revoke all on function fn_my_company_id() from public;
revoke all on function fn_my_role() from public;
revoke all on function fn_is_super_admin() from public;
revoke all on function fn_is_admin_role() from public;
revoke all on function fn_is_company_wide_viewer() from public;
revoke all on function fn_my_hotel_ids() from public;
revoke all on function fn_has_hotel_access(uuid) from public;

grant execute on function fn_my_company_id() to authenticated;
grant execute on function fn_my_role() to authenticated;
grant execute on function fn_is_super_admin() to authenticated;
grant execute on function fn_is_admin_role() to authenticated;
grant execute on function fn_is_company_wide_viewer() to authenticated;
grant execute on function fn_my_hotel_ids() to authenticated;
grant execute on function fn_has_hotel_access(uuid) to authenticated;

-- =====================================================================
-- 2. TRAVA CONTRA AUTO-PROMOÇÃO EM profiles
-- RLS por si só não restringe colunas dentro de uma linha permitida;
-- este trigger impede que o próprio usuário altere papel/empresa/status
-- ao editar seu perfil — só admins (fn_is_admin_role()) podem mudar isso.
-- =====================================================================

create or replace function fn_protect_profile_privileged_fields()
returns trigger
language plpgsql
as $$
begin
  if not fn_is_admin_role() then
    new.role_global := old.role_global;
    new.company_id := old.company_id;
    new.active := old.active;
    new.mfa_required := old.mfa_required;
    new.email := old.email;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_privileged on profiles;
create trigger trg_profiles_protect_privileged
  before update on profiles
  for each row execute function fn_protect_profile_privileged_fields();

-- =====================================================================
-- 3. GRANTS DE TABELA (pré-requisito do Postgres para RLS ser avaliada)
-- Nada é concedido a `anon`: este portal exige login para tudo.
-- =====================================================================

grant select, insert, update, delete on companies to authenticated;
grant select, insert, update, delete on hotels to authenticated;
grant select, update on profiles to authenticated;
grant select, insert, update, delete on hotel_users to authenticated;
grant select, insert, update, delete on approval_types to authenticated;
grant select, insert, update, delete on approval_rules to authenticated;
grant select, insert, update, delete on approval_rule_steps to authenticated;
grant select, insert, update, delete on documents to authenticated;
grant select, insert, delete on document_files to authenticated;
grant select, update on document_approval_steps to authenticated;
grant select, insert on approval_evidences to authenticated;
grant select on audit_logs to authenticated;
grant select, update, delete on notifications to authenticated;
grant select, insert, update, delete on document_comments to authenticated;

-- =====================================================================
-- 4. POLICIES — companies
-- =====================================================================

create policy companies_select on companies for select
  using (fn_is_super_admin() or id = fn_my_company_id());

create policy companies_insert on companies for insert
  with check (fn_is_super_admin());

create policy companies_update on companies for update
  using (fn_is_super_admin() or (fn_my_role() = 'admin_corporativo' and id = fn_my_company_id()))
  with check (fn_is_super_admin() or (fn_my_role() = 'admin_corporativo' and id = fn_my_company_id()));

create policy companies_delete on companies for delete
  using (fn_is_super_admin());

-- =====================================================================
-- 5. POLICIES — hotels
-- =====================================================================

create policy hotels_select on hotels for select
  using (fn_is_super_admin() or company_id = fn_my_company_id());

create policy hotels_insert on hotels for insert
  with check (fn_is_super_admin() or (fn_is_admin_role() and company_id = fn_my_company_id()));

create policy hotels_update on hotels for update
  using (fn_is_super_admin() or (fn_is_admin_role() and company_id = fn_my_company_id()))
  with check (fn_is_super_admin() or (fn_is_admin_role() and company_id = fn_my_company_id()));

create policy hotels_delete on hotels for delete
  using (fn_is_super_admin() or (fn_is_admin_role() and company_id = fn_my_company_id()));

-- =====================================================================
-- 6. POLICIES — profiles
-- (sem policy de insert/delete: perfis nascem via trigger de signup,
-- criado com a autenticação na próxima etapa, e nunca são apagados)
-- =====================================================================

create policy profiles_select on profiles for select
  using (fn_is_super_admin() or id = auth.uid() or company_id = fn_my_company_id());

create policy profiles_update on profiles for update
  using (fn_is_super_admin() or id = auth.uid() or (fn_my_role() = 'admin_corporativo' and company_id = fn_my_company_id()))
  with check (fn_is_super_admin() or id = auth.uid() or (fn_my_role() = 'admin_corporativo' and company_id = fn_my_company_id()));

-- =====================================================================
-- 7. POLICIES — hotel_users
-- =====================================================================

create policy hotel_users_select on hotel_users for select
  using (
    fn_is_super_admin()
    or user_id = auth.uid()
    or (
      exists (select 1 from hotels h where h.id = hotel_users.hotel_id and h.company_id = fn_my_company_id())
      and (fn_is_admin_role() or fn_is_company_wide_viewer() or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_users.hotel_id)))
    )
  );

create policy hotel_users_insert on hotel_users for insert
  with check (
    fn_is_super_admin()
    or (fn_is_admin_role() and exists (select 1 from hotels h where h.id = hotel_id and h.company_id = fn_my_company_id()))
    or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_id))
  );

create policy hotel_users_update on hotel_users for update
  using (
    fn_is_super_admin()
    or (fn_is_admin_role() and exists (select 1 from hotels h where h.id = hotel_users.hotel_id and h.company_id = fn_my_company_id()))
    or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_users.hotel_id))
  )
  with check (
    fn_is_super_admin()
    or (fn_is_admin_role() and exists (select 1 from hotels h where h.id = hotel_id and h.company_id = fn_my_company_id()))
    or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_id))
  );

create policy hotel_users_delete on hotel_users for delete
  using (
    fn_is_super_admin()
    or (fn_is_admin_role() and exists (select 1 from hotels h where h.id = hotel_users.hotel_id and h.company_id = fn_my_company_id()))
    or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_users.hotel_id))
  );

-- =====================================================================
-- 8. POLICIES — approval_types
-- =====================================================================

create policy approval_types_select on approval_types for select
  using (fn_is_super_admin() or company_id = fn_my_company_id());

create policy approval_types_insert on approval_types for insert
  with check (fn_is_super_admin() or (fn_is_admin_role() and company_id = fn_my_company_id()));

create policy approval_types_update on approval_types for update
  using (fn_is_super_admin() or (fn_is_admin_role() and company_id = fn_my_company_id()))
  with check (fn_is_super_admin() or (fn_is_admin_role() and company_id = fn_my_company_id()));

create policy approval_types_delete on approval_types for delete
  using (fn_is_super_admin() or (fn_is_admin_role() and company_id = fn_my_company_id()));

-- =====================================================================
-- 9. POLICIES — approval_rules
-- admin_hotel pode gerenciar regras específicas do(s) seu(s) hotel(is)
-- (hotel_id preenchido); regras corporativas (hotel_id nulo) exigem
-- admin_corporativo ou super_admin.
-- =====================================================================

create policy approval_rules_select on approval_rules for select
  using (fn_is_super_admin() or company_id = fn_my_company_id());

create policy approval_rules_insert on approval_rules for insert
  with check (
    fn_is_super_admin()
    or (fn_is_admin_role() and company_id = fn_my_company_id())
    or (fn_my_role() = 'admin_hotel' and hotel_id is not null and fn_has_hotel_access(hotel_id) and company_id = fn_my_company_id())
  );

create policy approval_rules_update on approval_rules for update
  using (
    fn_is_super_admin()
    or (fn_is_admin_role() and company_id = fn_my_company_id())
    or (fn_my_role() = 'admin_hotel' and hotel_id is not null and fn_has_hotel_access(hotel_id))
  )
  with check (
    fn_is_super_admin()
    or (fn_is_admin_role() and company_id = fn_my_company_id())
    or (fn_my_role() = 'admin_hotel' and hotel_id is not null and fn_has_hotel_access(hotel_id) and company_id = fn_my_company_id())
  );

create policy approval_rules_delete on approval_rules for delete
  using (
    fn_is_super_admin()
    or (fn_is_admin_role() and company_id = fn_my_company_id())
    or (fn_my_role() = 'admin_hotel' and hotel_id is not null and fn_has_hotel_access(hotel_id))
  );

-- =====================================================================
-- 10. POLICIES — approval_rule_steps (herdam a governança da regra pai)
-- =====================================================================

create policy approval_rule_steps_select on approval_rule_steps for select
  using (exists (select 1 from approval_rules r where r.id = approval_rule_steps.rule_id));

create policy approval_rule_steps_insert on approval_rule_steps for insert
  with check (
    exists (
      select 1 from approval_rules r
      where r.id = rule_id
        and (
          fn_is_super_admin()
          or (fn_is_admin_role() and r.company_id = fn_my_company_id())
          or (fn_my_role() = 'admin_hotel' and r.hotel_id is not null and fn_has_hotel_access(r.hotel_id))
        )
    )
  );

create policy approval_rule_steps_update on approval_rule_steps for update
  using (
    exists (
      select 1 from approval_rules r
      where r.id = approval_rule_steps.rule_id
        and (
          fn_is_super_admin()
          or (fn_is_admin_role() and r.company_id = fn_my_company_id())
          or (fn_my_role() = 'admin_hotel' and r.hotel_id is not null and fn_has_hotel_access(r.hotel_id))
        )
    )
  )
  with check (
    exists (
      select 1 from approval_rules r
      where r.id = rule_id
        and (
          fn_is_super_admin()
          or (fn_is_admin_role() and r.company_id = fn_my_company_id())
          or (fn_my_role() = 'admin_hotel' and r.hotel_id is not null and fn_has_hotel_access(r.hotel_id))
        )
    )
  );

create policy approval_rule_steps_delete on approval_rule_steps for delete
  using (
    exists (
      select 1 from approval_rules r
      where r.id = approval_rule_steps.rule_id
        and (
          fn_is_super_admin()
          or (fn_is_admin_role() and r.company_id = fn_my_company_id())
          or (fn_my_role() = 'admin_hotel' and r.hotel_id is not null and fn_has_hotel_access(r.hotel_id))
        )
    )
  );

-- =====================================================================
-- 11. POLICIES — documents
-- Combina: perímetro de empresa, vínculo de hotel, autoria e elegibilidade
-- de aprovação (fn_can_user_approve, criada na Etapa 2).
-- =====================================================================

create policy documents_select on documents for select
  using (
    fn_is_super_admin()
    or (company_id = fn_my_company_id() and fn_is_company_wide_viewer())
    or (company_id = fn_my_company_id() and created_by = auth.uid())
    or (company_id = fn_my_company_id() and fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_id))
    or fn_can_user_approve(id, auth.uid())
    or exists (
      select 1 from document_approval_steps das
      where das.document_id = documents.id
        and (das.approved_by = auth.uid() or das.rejected_by = auth.uid() or das.assigned_user_id = auth.uid())
    )
  );

create policy documents_insert on documents for insert
  with check (
    fn_is_super_admin()
    or (
      company_id = fn_my_company_id()
      and created_by = auth.uid()
      and fn_my_role() not in ('auditor','juridico','financeiro')
      and (fn_is_admin_role() or fn_has_hotel_access(hotel_id))
    )
  );

-- Edição livre só enquanto rascunho (não submetido); depois disso, só
-- a RPC de aprovação/rejeição da Etapa 5 muda status/current_step_order.
create policy documents_update on documents for update
  using (
    fn_is_super_admin()
    or (fn_is_admin_role() and company_id = fn_my_company_id())
    or (created_by = auth.uid() and status = 'draft')
  )
  with check (
    fn_is_super_admin()
    or (fn_is_admin_role() and company_id = fn_my_company_id())
    or (created_by = auth.uid() and status = 'draft')
  );

create policy documents_delete on documents for delete
  using (fn_is_super_admin());

-- =====================================================================
-- 12. POLICIES — document_files (herdam a visibilidade do documento pai)
-- =====================================================================

create policy document_files_select on document_files for select
  using (exists (select 1 from documents d where d.id = document_files.document_id));

create policy document_files_insert on document_files for insert
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from documents d
      where d.id = document_id and d.status = 'draft' and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_files_delete on document_files for delete
  using (
    exists (
      select 1 from documents d
      where d.id = document_files.document_id and d.status = 'draft' and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

-- =====================================================================
-- 13. POLICIES — document_approval_steps
-- A UPDATE é o coração da regra "apenas o aprovador correto aprova o
-- passo atual": só é permitida enquanto pending, só para quem
-- fn_can_user_approve() autoriza, e só transiciona para approved/rejected
-- com o próprio usuário como autor da decisão.
-- Sem policy de insert/delete: os passos nascem via função de submissão
-- (Etapa 5), nunca por escrita direta do cliente.
-- =====================================================================

create policy document_approval_steps_select on document_approval_steps for select
  using (exists (select 1 from documents d where d.id = document_approval_steps.document_id));

create policy document_approval_steps_update on document_approval_steps for update
  using (
    fn_is_super_admin()
    or (status = 'pending' and fn_can_user_approve(document_id, auth.uid()))
  )
  with check (
    fn_is_super_admin()
    or (
      status in ('approved','rejected')
      and (approved_by = auth.uid() or rejected_by = auth.uid())
    )
  );

-- =====================================================================
-- 14. POLICIES — approval_evidences
-- Append-only (a imutabilidade já é garantida por trigger na Etapa 2;
-- aqui simplesmente não existe policy de update/delete, reforçando isso).
-- Client só pode registrar eventos de baixo risco (view/download);
-- approve/reject/certificate_generated/admin_change só entram via
-- fn_record_evidence(), que é SECURITY DEFINER e tem EXECUTE bloqueado
-- para authenticated — só uma Edge Function de confiança poderá chamá-la.
-- =====================================================================

create policy approval_evidences_select on approval_evidences for select
  using (exists (select 1 from documents d where d.id = approval_evidences.document_id));

create policy approval_evidences_insert on approval_evidences for insert
  with check (
    user_id = auth.uid()
    and action in ('view','download')
    and exists (select 1 from documents d where d.id = approval_evidences.document_id)
  );

-- =====================================================================
-- 15. POLICIES — audit_logs
-- Somente leitura para papéis de gestão/auditoria; gravação é
-- exclusivamente via triggers/Edge Functions de confiança (sem policy
-- de insert/update/delete para authenticated).
-- =====================================================================

create policy audit_logs_select on audit_logs for select
  using (
    fn_is_super_admin()
    or (company_id = fn_my_company_id() and (fn_is_admin_role() or fn_is_company_wide_viewer()))
  );

-- =====================================================================
-- 16. POLICIES — notifications
-- =====================================================================

create policy notifications_select on notifications for select
  using (fn_is_super_admin() or user_id = auth.uid());

create policy notifications_update on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete on notifications for delete
  using (user_id = auth.uid() or fn_is_super_admin());

-- =====================================================================
-- 17. POLICIES — document_comments
-- Comentários internal_only ficam ocultos do solicitante (exceto os
-- que ele mesmo escreveu). Auditor/jurídico só leem, não comentam.
-- =====================================================================

create policy document_comments_select on document_comments for select
  using (
    exists (select 1 from documents d where d.id = document_comments.document_id)
    and (not internal_only or fn_my_role() <> 'solicitante' or user_id = auth.uid())
  );

create policy document_comments_insert on document_comments for insert
  with check (
    user_id = auth.uid()
    and fn_my_role() not in ('auditor','juridico')
    and exists (select 1 from documents d where d.id = document_comments.document_id)
  );

create policy document_comments_update on document_comments for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy document_comments_delete on document_comments for delete
  using (user_id = auth.uid() or fn_is_admin_role());

-- =====================================================================
-- 18. STORAGE — bucket "documents" + policies em storage.objects
-- Convenção obrigatória de caminho: o primeiro segmento do path DEVE
-- ser o document_id (uuid), ex.: "<document_id>/01-orcamento.pdf".
-- O storage.service.js (próxima etapa) deve respeitar essa convenção.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy documents_bucket_select on storage.objects for select
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from documents d
      where d.id::text = (storage.foldername(name))[1]
    )
  );

create policy documents_bucket_insert on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and exists (
      select 1 from documents d
      where d.id::text = (storage.foldername(name))[1]
        and d.status = 'draft'
        and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy documents_bucket_delete on storage.objects for delete
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from documents d
      where d.id::text = (storage.foldername(name))[1]
        and d.status = 'draft'
        and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );
