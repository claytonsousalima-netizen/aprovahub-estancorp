-- =====================================================================
-- AprovaHub Estancorp — correção: service_role sem EXECUTE nas funções
--
-- Mesma classe de bug da migração 0017 (tabelas), agora em funções:
-- "permission denied for function fn_process_approval" ao tentar
-- aprovar um documento de verdade pela primeira vez. Migrações
-- anteriores (0001, 0003, 0007, 0008, 0009, 0010, 0011, 0012, 0014,
-- 0016) fizeram "revoke all on function ... from public, anon,
-- authenticated" como parte do endurecimento de segurança (fechar o
-- acesso amplo via PUBLIC) — correto para anon/authenticated, mas
-- nenhuma delas re-concedeu EXECUTE a service_role depois disso.
-- Confirmado via has_function_privilege(): 10 de 30 funções de public
-- com EXECUTE pra service_role, 20 sem — incluindo fn_process_approval,
-- chamada pela Edge Function process-approval via client service_role.
-- =====================================================================

grant execute on all functions in schema public to service_role;

-- Pra funções criadas depois desta migração também saírem com o GRANT
-- certo, sem precisar lembrar de repetir isso manualmente.
alter default privileges in schema public
  grant execute on functions to service_role;
