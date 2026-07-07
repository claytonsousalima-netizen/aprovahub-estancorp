-- =====================================================================
-- AprovaHub Estancorp — correção: service_role sem GRANT nas tabelas
--
-- Descoberto ao testar "Convidar usuário" pela primeira vez num navegador
-- real, depois do deploy no GitHub Pages: admin-actions e process-approval
-- retornavam "permission denied for table profiles" ao consultar profiles
-- via client service_role — mesmo para um usuário confirmadamente
-- super_admin no banco.
--
-- Causa raiz: RLS e GRANT são dois sistemas de permissão separados no
-- Postgres. service_role tem o atributo BYPASSRLS (ignora as políticas de
-- RLS), mas isso não dispensa o GRANT básico de tabela (SELECT/INSERT/
-- UPDATE/DELETE) — sem o GRANT, a consulta nem chega a avaliar RLS, falha
-- direto com "permission denied". Nenhuma migração anterior concedeu esse
-- GRANT a service_role explicitamente (só profiles->authenticated, na
-- 0003) — aparentemente nunca foi herdado automaticamente pra nenhuma das
-- 15 tabelas de public. Confirmado via has_table_privilege(): 0 de 15.
--
-- Isso provavelmente quebrou, desde sempre, qualquer chamada
-- admin.from(<tabela>) feita pelo client service_role dentro das Edge
-- Functions (admin-actions, process-approval) — só não tinha sido
-- percebido porque nunca houve um teste ponta a ponta via navegador real
-- antes da publicação no GitHub Pages (os testes anteriores validavam via
-- SQL Editor/RPC direto, que roda como "postgres", não como service_role).
-- =====================================================================

grant select, insert, update, delete on all tables in schema public to service_role;

-- Pra tabelas criadas depois desta migração também saírem com o GRANT
-- certo, sem precisar lembrar de repetir isso manualmente.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
