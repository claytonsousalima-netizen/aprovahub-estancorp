-- =====================================================================
-- AprovaHub Estancorp — Etapa 14 (continuação): idade real da sessão
--
-- O claim "iat" do access token NÃO serve pra medir a idade real da
-- sessão: o client Supabase renova o access token silenciosamente a
-- cada ~55min enquanto a aba fica aberta, e cada renovação gera um
-- "iat" novo. Uma sessão de semanas ficaria com "iat" sempre fresco.
--
-- auth.sessions.created_at é o momento do login original e só muda com
-- um novo login — é isso que a process-approval Edge Function compara
-- ao limite de idade de sessão antes de liberar uma aprovação.
--
-- Só service_role pode chamar (a Edge Function usa o client admin);
-- authenticated/anon não recebem EXECUTE, já que a função lê o schema
-- auth diretamente.
-- =====================================================================

create or replace function fn_session_created_at(p_session_id uuid)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select created_at from auth.sessions where id = p_session_id;
$$;

revoke all on function fn_session_created_at(uuid) from public, anon, authenticated;
grant execute on function fn_session_created_at(uuid) to service_role;
