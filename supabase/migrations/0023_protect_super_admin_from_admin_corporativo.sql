-- =====================================================================
-- AprovaHub Estancorp — admin_corporativo (e admin_hotel) não podem
-- editar o acesso de um super_admin
--
-- Lacuna encontrada: fn_protect_profile_privileged_fields() só checava
-- fn_is_admin_role() (verdadeiro pra super_admin E admin_corporativo)
-- antes de liberar mudanças em role_global/company_id/active/
-- mfa_required/email — ou seja, qualquer admin_corporativo conseguia
-- editar, desativar, rebaixar ou até promover QUALQUER perfil, incluindo
-- um super_admin, contanto que estivesse na mesma empresa (RLS
-- profiles_update já permitia isso). admin_hotel já não tinha esse
-- acesso (não está em fn_is_admin_role() nem na RLS profiles_update),
-- então essa parte já estava protegida.
--
-- Correção: além de ser admin, agora também é preciso que a linha NÃO
-- seja (e não esteja virando) um super_admin — a menos que quem esteja
-- editando já seja, ele mesmo, super_admin. Assim só um super_admin
-- edita outro super_admin, ou promove alguém a super_admin.
-- =====================================================================

create or replace function fn_protect_profile_privileged_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or fn_is_super_admin() then
    return new;
  end if;

  if fn_is_admin_role() and old.role_global <> 'super_admin' and new.role_global <> 'super_admin' then
    return new;
  end if;

  new.role_global := old.role_global;
  new.company_id := old.company_id;
  new.active := old.active;
  new.mfa_required := old.mfa_required;
  new.email := old.email;
  return new;
end;
$$;
