# Checklist técnico de segurança — Etapa 14

Levantamento feito em 2026-07-07 contra o projeto Supabase `aprovahub-estancorp` (Free Plan) e o código deste repositório. Cada item foi verificado diretamente (consulta SQL, dashboard do Supabase ou leitura do código), não apenas assumido.

## 1. RLS em todas as tabelas sensíveis
**Status: OK.** As 15 tabelas de `public` têm RLS habilitada (checado via `pg_class.relrowsecurity`, 0 sem RLS). Além das policies, [0015_security_hardening.sql](supabase/migrations/0015_security_hardening.sql) fechou uma lacuna estrutural que RLS sozinha não cobria: quatro foreign keys (`hotels.company_id`, `documents.company_id`, `documents.hotel_id`, `audit_logs.company_id`) estavam com `ON DELETE CASCADE`. Cascata de FK acontece **abaixo** da RLS e dos triggers da tabela filha — ou seja, apagar uma `company`/`hotel` apagaria em cascata documentos aprovados/reprovados e audit_logs inteiros, sem passar pelas proteções de `documents`/`audit_logs`. Trocado para `ON DELETE RESTRICT`.

## 2. Nenhuma chave secreta no frontend
**Status: OK.** `src/config/supabase.js` só expõe `SUPABASE_URL` e a `publishable key` (uso público por design, controle real é via RLS). Confirmado por busca no código: a `service_role key` só aparece em comentários que reforçam a regra ("nunca no frontend") e é usada exclusivamente dentro das Edge Functions (`process-approval`, `admin-actions`), do lado do servidor.

## 3. Rate limit quando aplicável
**Status: OK, usando os limites nativos do Supabase Auth (Free Plan).** Confirmado em Authentication → Rate Limits:
- Login/cadastro (`grant_type=password`, signup): **30 requisições / 5 min por IP** (360/h)
- Renovação de sessão (token refresh): **150 requisições / 5 min por IP** (1.800/h)
- Verificação de OTP/magic link: **30 requisições / 5 min por IP** (360/h)

Não foi implementado rate limit customizado adicional (ex.: por usuário, nas Edge Functions) — os limites nativos por IP já cobrem os endpoints de autenticação, que são o alvo típico de força bruta/enumeração. Registrado como escopo aceito para este projeto (Free Plan); um rate limit mais granular exigiria infraestrutura extra (KV/Redis) fora do escopo desta etapa.

## 4. Logs de ações críticas
**Status: OK.** Dois mecanismos, sem depender de nenhuma tela "lembrar" de logar:
- `audit_logs`: trigger `fn_admin_audit_log` (Etapa 6) grava automaticamente todo INSERT/UPDATE/DELETE em `companies`, `hotels`, `profiles`, `hotel_users`, `approval_types`, `approval_rules`, `approval_rule_steps` — com autor, dado antigo e novo.
- `approval_evidences`: toda aprovação/rejeição grava uma evidência encadeada por hash (Etapa 2), com autor, IP, user-agent e método de autenticação usado.

## 5. Bloquear aprovação se MFA obrigatório não estiver configurado
**Status: OK, em três camadas independentes.**
- `session.js`: usuário com `mfa_required=true` sem fator TOTP verificado é redirecionado para `#mfa-setup` antes de conseguir chegar em qualquer tela de aprovação.
- `reauth-modal.js`: lança erro explícito se não encontrar fator MFA verificado no momento de assinar.
- `process-approval` (Edge Function): reconfere de forma independente — nunca confia no que o client alega. Para contas com `mfa_required=true`, exige o claim `aal2` no token (só existe se o desafio TOTP realmente aconteceu na sessão).

## 6. Bloquear aprovação se sessão estiver antiga demais
**Status: NOVO nesta etapa.** O Free Plan do Supabase não permite configurar expiração de sessão nem timeout de inatividade (confirmado em Authentication → Sessions: "Configuring user sessions is only available on the Pro Plan and above"). Implementado no lugar:
- [0016_session_age_check.sql](supabase/migrations/0016_session_age_check.sql): função `fn_session_created_at(uuid)`, `SECURITY DEFINER`, que lê `auth.sessions.created_at` (o momento do login original). `EXECUTE` restrito a `service_role`.
- `process-approval`: antes de processar a decisão, busca a idade real da sessão via essa função (usando o claim `session_id` do token) e bloqueia com 401 se passar de **12 horas**. Deliberadamente não foi usado o claim `iat` do access token para essa checagem — o SDK do Supabase renova o access token sozinho a cada ~55 min enquanto a aba fica aberta, então `iat` fica sempre fresco e nunca capturaria uma sessão de dias/semanas.
- **Limitação conhecida a validar em QA**: a implementação depende do claim `session_id` estar presente no JWT (padrão do GoTrue desde a introdução de AAL/MFA, mesma leva do claim `aal` já usado e testado em produção nesta etapa). Se por algum motivo esse claim não vier no token, a função retorna `null` e a checagem é pulada sem quebrar a aprovação — degrada de forma segura, mas recomenda-se testar uma aprovação real após o deploy e conferir os logs da função.

## 7. Reautenticar antes de aprovação
**Status: OK.** `confirmIdentityForSignature()` + `reauth-modal.js` pedem confirmação forte (TOTP ou senha) na hora de assinar. O `process-approval` reconfere de forma independente do lado do servidor — nunca aceita apenas a palavra do client:
- Conta com MFA: exige `aal2` no token (prova de desafio TOTP recente).
- Conta sem MFA: reconfere a senha enviada contra o GoTrue, de novo, mesmo que o client já tenha checado.

## 8. Impedir alteração de documentos após enviados, exceto comentário/admin controlado
**Status: OK, já coberto pela policy `documents_update` existente.** Confirmado via `pg_policies`: um usuário comum só pode dar UPDATE em documento próprio enquanto `status='draft'`. Depois de enviado, só resta a exceção prevista no próprio enunciado — perfis administrativos (`fn_is_admin_role()`, mesma empresa) continuam podendo atualizar. Comentários vivem em tabela separada (`document_comments`), fora dessa restrição.

## 9. Impedir alteração de arquivos após aprovação iniciada
**Status: OK, e mais estrito que o pedido.** Confirmado via `pg_policies` em `document_files`: não existe policy de UPDATE — arquivo anexado nunca pode ser alterado in-place, em nenhum status. INSERT e DELETE só são permitidos enquanto o documento pai está em `status='draft'`. Ou seja, a partir do momento em que o documento é enviado (`pending`), os arquivos ficam completamente imutáveis, não apenas após aprovação.

## 10. Impedir exclusão física de documentos aprovados/reprovados
**Status: NOVO nesta etapa.** A policy `documents_delete` antiga permitia `super_admin` apagar documento em **qualquer** status, inclusive aprovado/reprovado. [0015_security_hardening.sql](supabase/migrations/0015_security_hardening.sql) restringiu para `status='draft'` apenas — depois de enviado, o único caminho é o soft delete (item 11).

## 11. Criar soft delete quando necessário
**Status: OK, já existente desde a Etapa 9.** `fn_cancel_document` marca o documento como `status='cancelled'` em vez de apagar fisicamente — preserva histórico, evidências e trilha de auditoria.

## 12. Criar trilha de auditoria imutável
**Status: OK.** Dois mecanismos append-only, com trigger bloqueando UPDATE/DELETE via exceção:
- `approval_evidences`: imutável desde a Etapa 2, com hash encadeado (`fn_chain_evidence_hash`).
- `audit_logs`: **NOVO nesta etapa** — [0015_security_hardening.sql](supabase/migrations/0015_security_hardening.sql) adicionou `fn_prevent_audit_log_mutation()` com triggers `trg_audit_logs_no_update`/`trg_audit_logs_no_delete`. Antes, mesmo sem policy de UPDATE/DELETE para `authenticated`, nada impedia uma alteração feita com acesso direto ao banco.

## 13. Criar alerta visual para documentos sem MFA
**Status: NOVO nesta etapa.** Para contas com `mfa_required=false` (aprovação confirmada só por senha), foi adicionado um aviso:
- [pendentes.view.js](src/views/pendentes.view.js): banner no topo da lista de aprovações pendentes.
- [documento.view.js](src/views/documento.view.js): aviso dentro da própria caixa de aprovação (`approve-box`), junto dos botões Aprovar/Reprovar.

Ambos linkam direto para `#mfa-setup`, que agora reconhece esse caso (ativação voluntária) e ajusta o texto de introdução — antes só existia o texto para o caso obrigatório.

## 14. Criar política de senha e orientação para uso de MFA
**Status: NOVO nesta etapa, em duas frentes.**
- **Plataforma (Supabase Auth → Sign In / Providers → Email)**: senha mínima de 8 caracteres mantida; exigência de caracteres alterada de "nenhuma" para "letra minúscula, maiúscula e número" (`Lowercase, uppercase letters and digits`). Alterado e confirmado via dashboard (persistência verificada com reload da página). "Prevent use of leaked passwords" (checagem contra Have I Been Pwned) está indisponível — **exige Pro Plan**, mesma limitação do timeout de sessão.
- **Frontend**: texto de orientação sobre a política de senha adicionado em [change-password.view.js](src/views/change-password.view.js) e [set-password.view.js](src/views/set-password.view.js); mensagem de erro amigável para `weak_password` em [auth.js](src/auth/auth.js); orientação sobre quando/por que ativar MFA adicionada em [mfa-setup.view.js](src/views/mfa-setup.view.js) (texto diferente para MFA obrigatório vs. voluntário); card "Política atual" em [admin-security.view.js](src/views/admin-security.view.js) atualizado com os valores reais (antes tinha só texto genérico apontando para o dashboard).

---

## Limitações conhecidas (Free Plan do Supabase)
- Sem timeout de sessão/inatividade nativo — compensado pela checagem de idade de sessão descrita no item 6.
- Sem "Prevent use of leaked passwords" (HaveIBeenPwned) — mitigado pela exigência de complexidade de senha (item 14).
- Rate limit é o padrão do Supabase por IP, sem camada adicional por usuário/conta.

## Itens que dependem de teste manual pós-deploy
- Aprovar um documento de verdade (com e sem MFA) e conferir que a checagem de idade de sessão (item 6) não gera falso positivo/negativo — depende do claim `session_id` estar presente no token, como assumido.
