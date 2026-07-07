-- =====================================================================
-- AprovaHub Estancorp — Etapa 4: provisionamento automático de perfil
-- Sempre que um usuário é criado no Supabase Auth (convite, ou signup
-- caso venha a existir), este trigger cria a linha correspondente em
-- profiles automaticamente — sem isso, "verificação se profile existe"
-- sempre falharia para usuários recém-convidados.
--
-- Metadados opcionais que podem ser passados ao convidar (raw_user_meta_data):
--   full_name, role_global, company_id, mfa_required
-- Se ausentes, assume full_name a partir do e-mail, role_global='solicitante',
-- company_id=NULL (a definir por um admin) e mfa_required=true.
-- =====================================================================

create or replace function fn_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, company_id, full_name, email, role_global, active, mfa_required)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'company_id', '')::uuid,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'role_global', '')::user_role, 'solicitante'),
    true,
    coalesce((new.raw_user_meta_data->>'mfa_required')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function fn_handle_new_auth_user();
