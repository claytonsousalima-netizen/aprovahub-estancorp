-- =====================================================================
-- AprovaHub Estancorp — Etapa 4 (correção): trigger de proteção de
-- profiles bloqueava até ajustes legítimos feitos direto no SQL Editor.
--
-- Causa: fn_is_admin_role() consulta profiles usando auth.uid(), que é
-- NULL fora de uma sessão autenticada via PostgREST (ex.: SQL Editor,
-- conexão direta como "postgres"). Nesse caso a função sempre retornava
-- false e o trigger revertia role_global/company_id/active/mfa_required
-- de volta ao valor antigo, mesmo para o dono do projeto.
--
-- Correção: passa a permitir a alteração também quando auth.uid() IS NULL
-- (ou seja, fora do contexto de app autenticado — só acessível via SQL
-- Editor ou conexão direta ao Postgres, nunca pelo cliente do portal).
-- =====================================================================

create or replace function fn_protect_profile_privileged_fields()
returns trigger
language plpgsql
as $$
begin
  if not (fn_is_admin_role() or auth.uid() is null) then
    new.role_global := old.role_global;
    new.company_id := old.company_id;
    new.active := old.active;
    new.mfa_required := old.mfa_required;
    new.email := old.email;
  end if;
  return new;
end;
$$;
