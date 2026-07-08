# Plano de teste manual — Etapa 15

Este plano cobre os 21 cenários mínimos pedidos na Etapa 15. Ele foi escrito depois de conferir o estado real do banco (produção), não a partir de suposição — a seção 1 documenta exatamente o que já existe e o que precisa ser criado antes de rodar os cenários.

## 1. Dados de organização (seed)

Checado diretamente no banco em 2026-07-07: a empresa, os hotéis, os tipos de aprovação e as regras de alçada padrão **já existem em produção**, criados em etapas anteriores. Não há necessidade de recriá-los — recriar gastaria duplicidade em dados reais. Nada foi inserido nesta etapa nesse conjunto.

- **Empresa**: Estancorp
- **Hotéis** (8 no total, incluindo os 5 pedidos): Estanplaza Berrini, Estanplaza Funchal, Estanplaza Ibirapuera, Estanplaza International, Estanplaza Nações, Estanplaza Paulista, Gran Estanplaza Berrini, Pulso Faria Lima
- **Tipos de aprovação** (6): Compra, Contrato, Cotação, Diarista, Locação, Outros
- **Regras de alçada padrão** (2, aplicam a qualquer hotel/tipo — `hotel_id` e `approval_type_id` nulos = regra-fallback da empresa):
  - **R$ 0,00 a R$ 3.000,00** → rota curta, 2 etapas: `lider_area` → `lider_administrativo`
  - **A partir de R$ 3.000,01** → rota completa, 3 etapas: `lider_area` → `lider_administrativo` → `gerente_geral`

Esse é exatamente o corte de R$ 3.000 pedido nos cenários 6–9 — já está configurado, não precisou de nova regra.

O que **não** existe ainda e precisa ser criado antes de testar: contas de usuário de teste (perfis diferentes) e os vínculos delas com hotéis. Ver seção 2.

## 2. Usuários de teste

### 2.1. Como criar

Foi adicionado um botão **"+ Criar usuário de teste"** na tela **Admin → Usuários**, ao lado de "Convidar usuário". Diferente do convite (que manda e-mail e exige clicar num link), esse botão cria a conta já com e-mail confirmado e a senha que você digitar — não depende de caixa de entrada real, então funciona com os e-mails fictícios abaixo. Só usuários com papel `super_admin`/`admin_corporativo` veem o botão. Não é possível criar conta de teste com papel `super_admin` por ali (deliberado — esse papel continua sendo concedido só manualmente).

Use sempre a senha **`AprovaTeste#2026`** (atende à política: 8+ caracteres, maiúscula, minúscula e número) para todas as contas de teste, exceto onde indicado.

### 2.2. Roteiro de contas a criar

| # | E-mail | Nome | Papel global | MFA obrigatório | Ativo |
|---|---|---|---|---|---|
| 1 | teste.solicitante@aprovahub.test | Teste Solicitante | solicitante | Não | Sim |
| 2 | teste.solicitante.mfa@aprovahub.test | Teste Solicitante MFA | solicitante | **Sim** | Sim |
| 3 | teste.liderarea@aprovahub.test | Teste Líder de Área | lider_area | **Sim** | Sim |
| 4 | teste.lideradm@aprovahub.test | Teste Líder Administrativo | lider_administrativo | Não | Sim |
| 5 | teste.gerentegeral@aprovahub.test | Teste Gerente Geral | gerente_geral | **Sim** | Sim |
| 6 | teste.adminhotel@aprovahub.test | Teste Admin Hotel | admin_hotel | **Sim** | Sim |
| 7 | teste.admincorp@aprovahub.test | Teste Admin Corporativo | admin_corporativo | **Sim** | Sim |
| 8/9 | _(removido)_ | — | Os papéis `auditor` e `financeiro` foram removidos do sistema (não são mais selecionáveis) — ignore essas contas se já existirem. | — | — |
| 10 | teste.inativo@aprovahub.test | Teste Usuário Inativo | solicitante | Não | **Não** |
| 11 | teste.semhotel@aprovahub.test | Teste Sem Hotel | lider_area | Não | Sim |

### 2.3. Vínculos com hotel (tela Admin → Usuários por hotel)

Depois de criar as contas acima, vincule (menos a #11, que fica deliberadamente **sem nenhum vínculo** — é o cenário 18):

| Usuário | Hotel | Papel no hotel |
|---|---|---|
| Teste Solicitante (#1) | Estanplaza Berrini | solicitante |
| Teste Solicitante MFA (#2) | Estanplaza Berrini | solicitante |
| Teste Líder de Área (#3) | Estanplaza Berrini | lider_area |
| Teste Líder Administrativo (#4) | Estanplaza Berrini | lider_administrativo |
| Teste Gerente Geral (#5) | Estanplaza Berrini | gerente_geral |
| Teste Admin Hotel (#6) | Estanplaza Berrini | admin_hotel |

`admin_corporativo` normalmente enxerga por empresa inteira e não precisa de vínculo por hotel — deixe #7 sem vínculo, a não ser que algum cenário abaixo peça o contrário.

## 3. Cenários de teste

Cada cenário indica: conta a usar, passos, e o que é esperado. "PASS/FAIL" fica a critério de quem executa.

### 1. Login usuário ativo
Conta: Teste Solicitante (#1).
1. Acessar a tela de login, informar e-mail e senha.
2. **Esperado**: login bem-sucedido, redirecionado para a tela inicial correspondente ao papel (dashboard).

### 2. Login usuário inativo bloqueado
Conta: Teste Usuário Inativo (#10).
1. Tentar logar com e-mail e senha corretos.
2. **Esperado**: autenticação no Supabase passa, mas a aplicação detecta `active=false`, desloga automaticamente, mostra aviso "Sua conta está inativa" e volta para a tela de login.

### 3. Recuperar senha
Conta: qualquer uma com e-mail real (as contas `@aprovahub.test` não recebem e-mail de verdade — use uma conta real, como a sua própria, para este cenário específico).
1. Na tela de login, clicar "Esqueci minha senha", informar o e-mail.
2. **Esperado**: mensagem de confirmação de envio; e-mail chega com link de recuperação; ao clicar, cai na tela de definir nova senha; nova senha respeita a política (8+ caracteres, maiúscula/minúscula/número).

### 4. Configurar MFA
Conta: Teste Solicitante MFA (#2) — tem `mfa_required=true` e ainda não tem fator configurado.
1. Logar normalmente.
2. **Esperado**: em vez de cair no dashboard, é redirecionado automaticamente para a tela de configuração de MFA, com QR code.
3. Escanear com um app autenticador (Google Authenticator, Authy etc.), informar o código de 6 dígitos.
4. **Esperado**: MFA confirmado, segue para o dashboard.

### 5. Login com MFA
Conta: Teste Solicitante MFA (#2), já com fator configurado (depende do cenário 4 ter sido feito antes).
1. Deslogar e logar de novo com e-mail e senha.
2. **Esperado**: depois da senha, é pedido o código do autenticador antes de liberar o acesso.

### 6. Criar documento abaixo de R$ 3.000
Conta: Teste Solicitante (#1).
1. Criar nova solicitação no hotel Estanplaza Berrini, tipo "Compra", valor R$ 1.500,00.
2. Enviar.
3. **Esperado**: documento criado com status "Pendente"; ao abrir, a linha do tempo mostra exatamente 2 etapas (líder de área, líder administrativo) — sem gerente geral.

### 7. Criar documento acima de R$ 3.000
Conta: Teste Solicitante (#1).
1. Criar nova solicitação no mesmo hotel, tipo "Compra", valor R$ 8.000,00.
2. Enviar.
3. **Esperado**: linha do tempo mostra 3 etapas (líder de área, líder administrativo, gerente geral).

### 8. Validar rota curta sem GG
Depende do documento do cenário 6.
1. Aprovar como Teste Líder de Área (#3), depois como Teste Líder Administrativo (#4).
2. **Esperado**: depois da 2ª aprovação, o documento já vai para "Aprovado" — gerente geral nunca é chamado a participar, não aparece na lista de pendências dele.

### 9. Validar rota completa com GG
Depende do documento do cenário 7.
1. Aprovar como líder de área, depois líder administrativo.
2. **Esperado**: depois dessas duas, o documento continua "Pendente", aguardando Teste Gerente Geral (#5).
3. Aprovar como gerente geral.
4. **Esperado**: só agora o documento vai para "Aprovado".

### 10. Solicitante não aprova o próprio documento, salvo se regra permitir
Conta: Teste Solicitante (#1), sobre um documento criado por ele mesmo.
1. Abrir o próprio documento pendente.
2. **Esperado**: não aparece a caixa "Sua aprovação é necessária", mesmo que o solicitante também tenha vínculo com papel de aprovador em outro hotel — a etapa atual pede um papel diferente do dele nesse documento. Se alguma regra específica permitir o próprio solicitante aprovar (ex.: `required_user_id` apontando pra ele mesmo), documentar esse caso à parte — não é o comportamento padrão.

### 11. Aprovador nível 2 não aprova antes do nível 1
Conta: Teste Líder Administrativo (#4), sobre um documento ainda na etapa 1 (recém-criado, líder de área ainda não aprovou).
1. Abrir o documento.
2. **Esperado**: não aparece caixa de aprovação (a etapa atual é `lider_area`, não `lider_administrativo`).
3. Repetir tentando forçar via console (ver cenário 21) — deve falhar também.

### 12. Admin visualiza mas não assina, salvo se também tiver papel de aprovador
Conta: Teste Admin Hotel (#6) ou Teste Admin Corporativo (#7).
1. Abrir um documento pendente do hotel Berrini.
2. **Esperado**: consegue ver o documento (admin enxerga tudo da empresa/hotel), mas não aparece caixa de aprovação, já que o papel dele não é o exigido pela etapa atual.
3. Ir em Admin → Usuários por hotel e adicionar um vínculo de Teste Admin Hotel com papel `lider_area` no Berrini (além do papel global `admin_hotel`).
4. Reabrir o mesmo documento (se ainda estiver na etapa de líder de área).
5. **Esperado**: agora a caixa de aprovação aparece — confirma a exceção "salvo se também tiver papel de aprovador".
6. Desfazer o vínculo extra depois do teste, pra não confundir os próximos cenários.

### 13. Reprovação exige justificativa
Conta: qualquer aprovador da etapa atual de um documento pendente.
1. Clicar "Reprovar" sem preencher o campo de comentário.
2. **Esperado**: formulário bloqueia o envio com "Informe o motivo da reprovação." — não é possível reprovar sem justificativa.
3. Preencher o motivo e confirmar.
4. **Esperado**: documento vai para "Reprovado", motivo aparece na linha do tempo.

### 14. Aprovação exige senha/MFA
Duas variações:
- Conta com MFA obrigatório (ex.: Teste Líder de Área #3): ao aprovar, é pedido o código do autenticador antes de confirmar. Cancelar o código ou informar errado deve bloquear a aprovação.
- Conta sem MFA obrigatório (ex.: Teste Líder Administrativo #4): ao aprovar, é pedida a senha atual. Senha errada deve bloquear a aprovação com "Senha incorreta.".

### 15. Evidência é gravada
Depois de qualquer aprovação/reprovação (cenários 8, 9 ou 13).
1. Abrir o documento, aba "Histórico/Auditoria".
2. **Esperado**: aparece uma entrada de evidência com o nome de quem assinou, papel na época, se foi MFA ou senha reconfirmada, hash da evidência.

### 16. Audit log é gravado
Conta: um perfil com acesso ao log administrativo (admin_corporativo, super_admin, juridico).
1. Ir em Admin → Logs de Auditoria.
2. **Esperado**: aparecem entradas para ações administrativas recentes (ex.: criação dos usuários de teste, vínculos com hotel) com autor, dado antigo/novo.

### 17. Certificado é gerado
Depende de um documento totalmente aprovado (cenário 8 ou 9 concluído).
1. Abrir o documento aprovado, aba "Certificado".
2. **Esperado**: número de certificado, QR code, link de validação pública, lista de aprovadores com data/IP/método de autenticação.
3. Abrir o link de validação (fora do app, sem estar logado).
4. **Esperado**: página pública confirma os dados básicos do certificado.

### 18. Usuário sem hotel não vê documento
Conta: Teste Sem Hotel (#11) — sem nenhum vínculo em `hotel_users`.
1. Logar e abrir "Pendentes"/"Arquivo".
2. **Esperado**: nenhum documento do hotel Berrini aparece na lista, mesmo que o papel global (`lider_area`) bata com alguma etapa — falta o vínculo com o hotel.

### 19. _(Removido — papel `auditor` não existe mais no sistema)_

### 20. Storage não permite download não autorizado
Conta: Teste Sem Hotel (#11) ou qualquer conta sem acesso ao documento.
1. Pegar a URL de um arquivo anexado a um documento do Berrini (via inspecionar rede, com uma conta que tem acesso).
2. Tentar abrir essa URL diretamente logado como Teste Sem Hotel (ou deslogado).
3. **Esperado**: acesso negado — o bucket é privado e o link não é uma URL pública direta; sem uma sessão com RLS que autorize aquele documento, o Storage recusa.

### 21. Tentativa de burlar frontend via console não consegue aprovar por causa da RLS/RPC
Conta: Teste Líder Administrativo (#4), sobre um documento ainda na etapa 1.
1. Abrir o DevTools do navegador (F12) enquanto logado no app.
2. No console, chamar diretamente a função que o frontend usaria, por exemplo:
   ```js
   const { data: { session } } = await window.supabase.auth.getSession();
   fetch('https://syhztzieyjuvrsmupvxh.supabase.co/functions/v1/process-approval', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
     body: JSON.stringify({ documentId: '<id-do-documento-na-etapa-1>', decision: 'approve' }),
   }).then(r => r.json()).then(console.log);
   ```
3. **Esperado**: a Edge Function `process-approval` chama `fn_process_approval`, que confere a etapa atual e o papel de quem está chamando — retorna erro (não é a vez desse aprovador) em vez de aprovar. Nenhuma linha é alterada em `documents`/`approval_evidences`.

## 4. Limitações conhecidas do plano

- Cenário 3 (recuperar senha) não funciona com as contas `@aprovahub.test`, já que não são caixas de e-mail reais — use uma conta com e-mail de verdade só para esse cenário.
- Os cenários dependem uns dos outros na ordem em que aparecem (ex.: 8/9 dependem de 6/7; 15/16/17 dependem de 8/9/13 já terem sido executados). Rodar fora de ordem pode dar falso negativo.
- O vínculo extra criado no cenário 12 deve ser desfeito antes de repetir os cenários 8/9/11 com a mesma conta, senão o Admin Hotel passa a aparecer como aprovador legítimo também nos outros testes.
