-- =====================================================================
-- AprovaHub Estancorp — comparativo de propostas (aba "Comparativo")
--
-- Recurso totalmente opcional: quem cria/gerencia o documento pode montar
-- uma grade comparando as propostas anexadas (fornecedor, valor, prazo de
-- pagamento, prazo de entrega, e qualquer outra linha que queiram
-- adicionar), sem que isso seja obrigatório — o processo continua
-- funcionando normalmente com apenas os PDFs/Excel anexados, como hoje.
--
-- Modelo: linhas (document_quote_rows) são compartilhadas pelo documento
-- inteiro — renomear uma linha atualiza ela para todas as propostas de
-- uma vez, em vez de "linhas" soltas por proposta que dessincronizariam
-- ao renomear. Colunas (document_quote_proposals) são as propostas em si,
-- cada uma podendo apontar opcionalmente para um arquivo já anexado
-- (document_files). Células (document_quote_values) guardam o valor
-- digitado de cada linha × proposta.
--
-- Diferente de document_files, a janela de edição não fica restrita a
-- status='draft': essa informação é só apoio para o aprovador, não entra
-- no hash encadeado de evidências (diferente dos arquivos, cujo hash
-- compõe files_hash em fn_process_approval), então é seguro deixar o
-- criador/admin editar enquanto o documento ainda está pendente de
-- decisão, não só durante o rascunho.
-- =====================================================================

create table document_quote_rows (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  label text not null,
  row_order integer not null default 1,
  created_at timestamptz not null default now()
);

create table document_quote_proposals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  label text not null,
  file_id uuid references document_files(id) on delete set null,
  proposal_order integer not null default 1,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table document_quote_values (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  row_id uuid not null references document_quote_rows(id) on delete cascade,
  proposal_id uuid not null references document_quote_proposals(id) on delete cascade,
  value text,
  updated_at timestamptz not null default now(),
  unique (row_id, proposal_id)
);

create index idx_document_quote_rows_document on document_quote_rows(document_id);
create index idx_document_quote_proposals_document on document_quote_proposals(document_id);
create index idx_document_quote_values_document on document_quote_values(document_id);
create index idx_document_quote_values_proposal on document_quote_values(proposal_id);

drop trigger if exists trg_document_quote_proposals_updated_at on document_quote_proposals;
create trigger trg_document_quote_proposals_updated_at
  before update on document_quote_proposals
  for each row execute function fn_set_updated_at();

drop trigger if exists trg_document_quote_values_updated_at on document_quote_values;
create trigger trg_document_quote_values_updated_at
  before update on document_quote_values
  for each row execute function fn_set_updated_at();

alter table document_quote_rows enable row level security;
alter table document_quote_proposals enable row level security;
alter table document_quote_values enable row level security;

grant select, insert, update, delete on document_quote_rows to authenticated;
grant select, insert, update, delete on document_quote_proposals to authenticated;
grant select, insert, update, delete on document_quote_values to authenticated;
grant select, insert, update, delete on document_quote_rows to service_role;
grant select, insert, update, delete on document_quote_proposals to service_role;
grant select, insert, update, delete on document_quote_values to service_role;

-- Herdam visibilidade do documento pai, igual document_files/document_comments.
create policy document_quote_rows_select on document_quote_rows for select
  using (exists (select 1 from documents d where d.id = document_quote_rows.document_id));

create policy document_quote_proposals_select on document_quote_proposals for select
  using (exists (select 1 from documents d where d.id = document_quote_proposals.document_id));

create policy document_quote_values_select on document_quote_values for select
  using (exists (select 1 from documents d where d.id = document_quote_values.document_id));

-- Escrita: só enquanto o documento ainda não foi decidido (draft ou
-- pending), e só por quem criou o documento ou um admin.
create policy document_quote_rows_insert on document_quote_rows for insert
  with check (
    exists (
      select 1 from documents d
      where d.id = document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_quote_rows_update on document_quote_rows for update
  using (
    exists (
      select 1 from documents d
      where d.id = document_quote_rows.document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  )
  with check (
    exists (
      select 1 from documents d
      where d.id = document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_quote_rows_delete on document_quote_rows for delete
  using (
    exists (
      select 1 from documents d
      where d.id = document_quote_rows.document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_quote_proposals_insert on document_quote_proposals for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from documents d
      where d.id = document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_quote_proposals_update on document_quote_proposals for update
  using (
    exists (
      select 1 from documents d
      where d.id = document_quote_proposals.document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  )
  with check (
    exists (
      select 1 from documents d
      where d.id = document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_quote_proposals_delete on document_quote_proposals for delete
  using (
    exists (
      select 1 from documents d
      where d.id = document_quote_proposals.document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_quote_values_insert on document_quote_values for insert
  with check (
    exists (
      select 1 from documents d
      where d.id = document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_quote_values_update on document_quote_values for update
  using (
    exists (
      select 1 from documents d
      where d.id = document_quote_values.document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  )
  with check (
    exists (
      select 1 from documents d
      where d.id = document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_quote_values_delete on document_quote_values for delete
  using (
    exists (
      select 1 from documents d
      where d.id = document_quote_values.document_id and d.status in ('draft', 'pending') and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );
