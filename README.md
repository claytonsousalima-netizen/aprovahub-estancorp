# AprovaHub — Portal de Aprovações Estancorp

Portal eletrônico de aprovação de documentos multiusuário para a rede hoteleira Estancorp: solicitação, roteamento por alçada de valor, assinatura interna com reautenticação forte (senha ou MFA), trilha de auditoria imutável e certificado de aprovação com validação pública.

## Visão geral

O AprovaHub substitui o fluxo manual de aprovação de documentos administrativos (compras, contratos, cotações, diárias, locações) por um portal web com:

- **Roteamento automático por alçada**: cada documento segue uma rota de aprovação (1 a 3 etapas — líder de área, líder administrativo e, para valores mais altos, gerente geral) definida por regras configuráveis de valor mínimo/máximo por tipo de documento e hotel.
- **Controle de acesso por empresa e hotel**: cada usuário só vê e aprova o que está no escopo da sua empresa/hotel, aplicado inteiramente via Row Level Security (RLS) no Postgres — não por lógica de frontend.
- **Autenticação forte antes de assinar**: aprovar ou reprovar exige reconfirmação de senha ou, para contas com MFA obrigatório, um código TOTP válido gerado na hora — nunca apenas um clique.
- **Trilha de auditoria imutável**: toda aprovação gera uma evidência encadeada por hash (append-only); toda ação administrativa crítica gera uma entrada de log que não pode ser alterada nem apagada, nem por quem tem acesso direto ao banco.
- **Certificado de aprovação com validação pública**: ao final da rota, o documento recebe um número de certificado com QR code e link de validação pública, sem exigir login.

Este projeto foi construído em etapas incrementais (documentadas no histórico de commits/migrações); [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) resume o estado de segurança atual, [TEST_PLAN.md](TEST_PLAN.md) traz o plano de teste manual e os dados de seed usados para QA, e [MANUAL_OPERACAO.html](MANUAL_OPERACAO.html) é o manual de operação para usuários finais, com todas as telas e os 10 perfis de acesso.

## Tecnologias

- **Frontend**: HTML, CSS e JavaScript puro (ES Modules nativos do navegador) — **sem bundler, sem framework, sem etapa de build**. O roteamento é feito por hash (`#pendentes`, `#documento/<id>` etc.), o que funciona out-of-the-box em hospedagem estática como GitHub Pages, sem precisar de rewrite de servidor.
- **Backend**: [Supabase](https://supabase.com) — Postgres com Row Level Security, Auth (e-mail/senha + MFA TOTP), Storage (dois buckets privados: anexos e certificados gerados) e Edge Functions (Deno) para as poucas operações que precisam da `service_role key` (aprovar/reprovar com reautenticação verificada no servidor, convidar usuário, criar conta de teste, resetar MFA, notificação por e-mail).
- **E-mail transacional**: [Resend](https://resend.com), chamado só de dentro da Edge Function `send-notification-email`.

## Estrutura de pastas

```
.
├── index.html                  # Entrada da aplicação (SPA com roteamento por hash)
├── validate.html                # Página pública de validação de certificado (sem login)
├── src/
│   ├── main.js                  # Registro de rotas e bootstrap da sessão
│   ├── config/supabase.js       # URL + chave pública do Supabase (client-side)
│   ├── auth/                    # Sessão, login/senha, MFA (TOTP)
│   ├── routes/router.js         # Roteador por hash
│   ├── components/              # UI reutilizável (modal, toast, sidebar, reautenticação)
│   ├── services/                # Chamadas ao Supabase (documentos, aprovações, relatórios...)
│   ├── views/                   # Uma tela por arquivo (login, dashboard, admin-*, documento...)
│   ├── constants/                # Papéis de usuário e rótulos
│   └── styles/main.css
└── supabase/
    ├── migrations/               # 0001 a 0024, aplicadas em ordem no SQL Editor
    └── functions/                # process-approval, admin-actions, send-notification-email
```

## Como configurar o Supabase

1. **Criar o projeto**: [supabase.com/dashboard](https://supabase.com/dashboard) → New Project. Anote a URL e a chave pública (anon/publishable) em Project Settings → API.
2. **Rodar as migrações, em ordem**: abra o SQL Editor do projeto e execute cada arquivo de `supabase/migrations/` de `0001_initial_schema.sql` até `0024_protect_super_admin_role_hotel.sql`, um de cada vez, na ordem numérica. Elas criam as tabelas, RLS, funções, triggers, os dois buckets de Storage (`document-files`, `generated-certificates`) e os GRANTs de tabela/função para `service_role` (0017 e 0018 são essenciais — sem elas, qualquer Edge Function que consulte uma tabela ou chame uma função diretamente falha com "permission denied", mesmo com RLS/políticas corretas). A 0019 corrige o `search_path` das funções de aprovação/evidência para enxergar a extensão `pgcrypto` (schema `extensions`), evitando o erro "function digest(text, unknown) does not exist" ao aprovar/reprovar documentos. A 0020 impede que o mesmo usuário aprove duas etapas do mesmo documento (segregação de funções), mesmo que ele acumule Papel Global e Papel no Hotel que batam com etapas diferentes. A 0021 cria as tabelas do comparativo de propostas (aba "Comparativo", opcional). A 0022 remove os papéis "financeiro" e "auditor" das funções/políticas que os citavam por nome (a lista de papéis em si é controlada pelo frontend, em `src/constants/roles.js`). A 0023 impede que admin_corporativo edite, desative ou promova o acesso de um super_admin — só outro super_admin pode. A 0024 estende essa mesma proteção ao Papel no Hotel (`hotel_users.role_hotel`) — nem admin_corporativo nem admin_hotel podem conceder papel "super_admin" num vínculo com hotel. A migração 0002 também popula os dados de referência da Estancorp (empresa, hotéis, tipos de documento) — se for adaptar o projeto para outra empresa, edite ou pule essa migração.
3. **Publicar as Edge Functions**: via [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase functions deploy process-approval`, `admin-actions`, `send-notification-email`) ou colando o conteúdo de cada `supabase/functions/<nome>/index.ts` na aba Code do Edge Functions do dashboard e clicando Deploy. `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já ficam disponíveis automaticamente dentro das funções — não precisa configurar.
4. **Configurar o segredo de e-mail**: em Edge Functions → Secrets, defina `RESEND_API_KEY` (chave da sua conta Resend) e, opcionalmente, `NOTIFICATIONS_FROM_ADDRESS` (remetente das notificações; padrão `AprovaHub <notificacoes@estancorp.com.br>`).
5. **Configurar SMTP customizado para os e-mails de Auth (convite, recuperação de senha)**: em Authentication → Emails → SMTP Settings, ative "Enable custom SMTP" e use a mesma conta Resend: Host `smtp.resend.com`, Porta `465`, Username `resend`, Password a sua `RESEND_API_KEY`. **Sem isso, o serviço de e-mail embutido do Supabase tem um limite fixo de 2 e-mails/hora, não configurável** — convidar mais de 2 usuários (ou testar recuperação de senha algumas vezes) na mesma hora falha com "Edge Function returned a non-2xx status code" ou erro de rate limit. Depois de ativar o SMTP customizado, o limite passa a ser ajustável em Authentication → Rate Limits (usamos 30/h).
6. **Conferir a política de senha e MFA**: em Authentication → Sign In / Providers → Email, confirme mínimo de 8 caracteres com letra maiúscula, minúscula e número (é o padrão que este projeto assume — veja [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) para o racional completo e as limitações do plano Free).

## Configurar URLs autorizadas no Supabase Auth

Sem isso, os links de convite/recuperação de senha por e-mail e o login não completam corretamente depois do deploy:

1. Authentication → URL Configuration.
2. **Site URL**: a URL final do GitHub Pages (ex.: `https://seu-usuario.github.io/seu-repo/`).
3. **Redirect URLs**: adicione a mesma URL (e, se for testar localmente, também `http://localhost:5173/` ou a porta que você usar). Como o roteamento é por hash, não é preciso cadastrar uma URL por tela — só a raiz do site.

## Variáveis públicas seguras

Este projeto não usa um mecanismo de `.env` em tempo de execução (não há build step). As únicas duas variáveis necessárias no frontend são públicas por design — o controle de acesso real é feito por RLS no Postgres, nunca por essas chaves:

| Variável | Onde encontrar | Onde usar |
|---|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL | `src/config/supabase.js` (constante `SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | Project Settings → API → Project API keys (chave `anon`/`publishable`) | `src/config/supabase.js` (constante `SUPABASE_PUBLISHABLE_KEY` — mesmo conceito, nome atual da chave anon nos projetos Supabase mais novos) |

Veja [.env.example](.env.example) para o formato de referência. Antes de publicar, edite `src/config/supabase.js` e substitua os dois valores pelos do seu projeto.

**Nunca** coloque a `service_role key` em nenhum arquivo do frontend, em `.env.example`, em commits ou em qualquer lugar acessível pelo navegador — ela ignora RLS e dá acesso total ao banco. Ela só deve existir dentro das Edge Functions, onde o próprio Supabase já a disponibiliza automaticamente.

## Como rodar localmente

Não há instalação de dependências nem build. Sirva a pasta com qualquer servidor estático (ES Modules exigem `http://`, não abrem direto como `file://`):

```bash
npx serve .
# ou
python -m http.server 5173
```

Depois abra `http://localhost:5173` (ou a porta escolhida). Lembre de adicionar essa URL em Redirect URLs (seção acima) se for testar login/recuperação de senha.

## Como publicar (GitHub Pages)

1. Suba o repositório para o GitHub (`git init`, `git add`, `git commit`, `git remote add origin ...`, `git push`).
2. No GitHub: Settings → Pages → Source: "Deploy from a branch" → Branch: `main` (ou a branch principal) → pasta `/ (root)`.
3. Aguarde o deploy (alguns minutos) e acesse a URL gerada (`https://seu-usuario.github.io/seu-repo/`).
4. Volte no Supabase e confirme que essa URL está em Site URL / Redirect URLs (seção acima) — sem isso o login quebra em produção mesmo que o site esteja no ar.
5. A página pública de validação de certificado fica em `https://seu-usuario.github.io/seu-repo/validate.html`.

## Como criar o primeiro admin

Não existe autocadastro de administrador — por design, contas novas nascem com o papel `solicitante`, e só um admin pode convidar/promover outras contas. Para o primeiro acesso:

1. No Supabase Dashboard: Authentication → Users → "Add user" → "Create new user".
2. Preencha e-mail e senha, marque "Auto Confirm User", e no campo de metadados do usuário (User Metadata / raw_user_meta_data) informe:
   ```json
   { "full_name": "Seu Nome", "role_global": "super_admin", "mfa_required": true }
   ```
   O trigger de provisionamento (`fn_handle_new_auth_user`) cria automaticamente o perfil já com esse papel — não precisa editar a tabela `profiles` na mão.
3. Se preferir criar o usuário sem metadados e ajustar depois, associe manualmente o `company_id` da Estancorp (`select id from companies where slug = 'estancorp'`) e o papel via `update profiles set role_global = 'super_admin', company_id = '<id>' where email = '...'` — rode isso você mesmo pelo SQL Editor; é uma operação de escalonamento de privilégio e não deve ser automatizada.
4. Faça login com essa conta; a partir daí, use a tela Admin → Usuários para convidar (ou, para QA, criar direto com senha) as demais contas.

## Como testar

Veja [TEST_PLAN.md](TEST_PLAN.md): roteiro completo de 21 cenários manuais (login, MFA, alçada por valor, reprovação, evidência, auditoria, certificado, isolamento por hotel, tentativa de burlar via console etc.), incluindo a lista de contas de teste a criar e como criá-las pela tela Admin → Usuários.

## Segurança e conformidade

[SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) documenta item a item: RLS em todas as tabelas, ausência de chaves privadas no frontend, rate limiting, log de ações críticas, bloqueio de aprovação sem MFA/sessão antiga, reautenticação obrigatória, imutabilidade de documentos/arquivos/auditoria após envio, soft delete, política de senha e orientação de uso de MFA — com o que já estava implementado, o que foi reforçado e as limitações conhecidas do plano Free do Supabase.

## Limitações jurídicas da assinatura interna

**Importante: leia antes de usar este sistema para decisões que dependam de validade jurídica formal de assinatura eletrônica.**

A "assinatura" do AprovaHub é um controle de **workflow interno**: ela prova, dentro do próprio sistema, que uma pessoa autenticada (com senha reconfirmada ou código MFA validado no momento) tomou uma decisão sobre um documento, com data, IP, user-agent e hash de evidência encadeado e imutável. Isso é equivalente, em espírito, a uma **assinatura eletrônica simples** — suficiente para controle interno, trilha de auditoria corporativa e responsabilização dentro da organização.

O que este sistema **não** oferece:

- **Certificação por Autoridade Certificadora (AC) credenciada pela ICP-Brasil.** Não há vínculo com certificado digital A1/A3 nem carimbo do tempo de uma AC.
- **Presunção legal de autoria/integridade equivalente à assinatura qualificada** prevista no art. 10, §1º da MP 2.200-2/2001 (que só se aplica a documentos assinados com certificado ICP-Brasil).
- **Validade automática perante terceiros externos à Estancorp** (bancos, cartórios, órgãos públicos, contrapartes contratuais) — para esses casos, a validade depende de aceitação da outra parte ou de exigência legal específica que permita outros meios de comprovação (ex.: art. 10, §2º da MP 2.200-2, que admite outros meios de comprovação de autoria/integridade "admitido pelas partes como válido" ou aceito pela pessoa a quem for oposto o documento).

Em outras palavras: o sistema é robusto e auditável para uso **interno** da Estancorp (aprovações administrativas, compras, contratos entre a própria empresa e suas áreas), mas **não substitui** uma assinatura ICP-Brasil quando a lei exigir especificamente essa forma, nem garante por si só efeito perante terceiros que não tenham previamente aceitado esse meio de comprovação. Para documentos que precisem de força probante mais forte ou de validade automática fora da empresa, recomenda-se: (a) obter aceite expresso da contraparte quanto a esse meio de assinatura, ou (b) usar uma plataforma de assinatura eletrônica com certificação ICP-Brasil para esses casos específicos.

Este texto é uma explicação técnica do que o sistema faz e não faz — não é parecer jurídico. Para uma avaliação formal de validade probatória em um caso concreto, consulte a área jurídica da empresa.

## Possibilidade futura de integração com Authentique, Gov.br ou ICP-Brasil

O desenho atual (evidência de aprovação com hash encadeado, imutável, com autor/data/IP/método de autenticação) foi pensado para ser compatível com uma evolução futura sem precisar refazer o modelo de dados:

- **[Authentique](https://authentique.com.br)** ou plataformas similares de e-signature: poderiam ser chamadas via API no momento da aprovação final, gerando um documento assinado externamente cujo identificador/hash seria gravado junto da evidência já existente em `approval_evidences` — mantendo a trilha de auditoria interna e acrescentando a camada de assinatura certificada por fora.
- **Gov.br (assinatura eletrônica do governo)**: viável como método de autenticação adicional/alternativo ao MFA TOTP atual, para os casos em que se queira vincular a identidade do aprovador a uma conta gov.br verificada.
- **ICP-Brasil (certificado digital A1/A3)**: o caminho para presunção legal de autenticidade equivalente à assinatura qualificada (MP 2.200-2). Exigiria integração com uma Autoridade Certificadora credenciada para assinar o PDF final (ex.: via biblioteca de assinatura CAdES/PAdES) no momento em que o certificado de aprovação é gerado, substituindo (ou complementando) o hash interno atual por uma assinatura criptográfica verificável por qualquer terceiro, sem depender de confiar no AprovaHub.

Nenhuma dessas integrações está implementada hoje — são possibilidades de evolução, registradas aqui para orientar decisões futuras de arquitetura.
