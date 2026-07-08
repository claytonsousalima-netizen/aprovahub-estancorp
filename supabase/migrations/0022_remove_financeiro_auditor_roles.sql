-- =====================================================================
-- AprovaHub Estancorp — remover os papéis "financeiro" e "auditor" do
-- uso prático do sistema (a empresa não precisa desses dois perfis).
--
-- Decisão de escopo: NÃO removemos os dois valores do enum user_role em
-- si. Postgres não tem "ALTER TYPE ... DROP VALUE" — remover um valor de
-- enum de verdade exige recriar o tipo inteiro (renomear o antigo, criar
-- um novo sem esses valores, migrar as 4 colunas que usam esse tipo:
-- profiles.role_global, hotel_users.role_hotel, approval_rule_steps.
-- role_required, document_approval_steps.role_required — e recriar
-- fn_my_role(), que retorna esse tipo). Confirmado por query direta que
-- nenhuma linha em nenhuma dessas 4 colunas usa 'financeiro' ou 'auditor'
-- hoje, então tecnicamente seria seguro — mas é uma cirurgia grande pra
-- um ganho prático nulo, já que a aplicação (ROLES em constants/roles.js)
-- nunca mais oferece esses papéis como opção em nenhum formulário.
--
-- O que de fato precisava mudar no banco: as duas funções/políticas que
-- citavam esses papéis explicitamente por nome.
-- =====================================================================

-- fn_is_company_wide_viewer(): 'financeiro' e 'auditor' saem da lista de
-- papéis com visão da empresa inteira (agora só admin_corporativo e
-- juridico têm esse acesso amplo por padrão, além de super_admin via
-- fn_is_admin_role() nas políticas que combinam os dois).
create or replace function fn_is_company_wide_viewer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role_global in ('admin_corporativo','juridico') from profiles where id = auth.uid()), false);
$$;

-- documents_insert: a lista de papéis bloqueados de criar documento agora
-- é só 'juridico' — 'auditor' e 'financeiro' já não existem mais como
-- opção selecionável, mas a policy antiga citava os dois por nome.
drop policy if exists documents_insert on documents;
create policy documents_insert on documents for insert
  with check (
    fn_is_super_admin()
    or (
      company_id = fn_my_company_id()
      and created_by = auth.uid()
      and fn_my_role() not in ('juridico')
      and (fn_is_admin_role() or fn_has_hotel_access(hotel_id))
    )
  );

-- document_comments_insert: mesma limpeza — só 'juridico' segue bloqueado
-- de comentar.
drop policy if exists document_comments_insert on document_comments;
create policy document_comments_insert on document_comments for insert
  with check (
    user_id = auth.uid()
    and fn_my_role() not in ('juridico')
    and exists (select 1 from documents d where d.id = document_comments.document_id)
  );
