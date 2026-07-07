-- =====================================================================
-- AprovaHub Estancorp — Etapa 12: Storage e proteção de documentos
-- Depende de 0001..0012 já aplicadas.
--
-- Substitui o bucket único "documents" (Etapa 2/3) por dois buckets
-- nomeados conforme a Etapa 12, ambos privados, com limite de tamanho e
-- lista de mime types permitidos configurados no PRÓPRIO bucket (não só
-- validados no frontend — isso é reforço server-side real, um client
-- malicioso não consegue burlar). O caminho passa a ser
-- company_id/hotel_id/document_id/NN-arquivo, então document_id agora é
-- o 3º segmento (storage.foldername(name))[3], não mais o 1º.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-files', 'document-files', false, 20971520,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generated-certificates', 'generated-certificates', false, 5242880, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- Remove as policies antigas do bucket "documents" (Etapa 3) — o bucket
-- em si fica intacto (não apagamos dados), só paramos de conceder acesso
-- por ele; uploads novos vão para "document-files".
-- =====================================================================

drop policy if exists documents_bucket_select on storage.objects;
drop policy if exists documents_bucket_insert on storage.objects;
drop policy if exists documents_bucket_delete on storage.objects;

-- =====================================================================
-- document-files: mesma governança de antes (visibilidade = quem vê o
-- documento; insert/delete só enquanto rascunho, pelo autor ou admin),
-- só que lendo o document_id do 3º segmento do path.
-- =====================================================================

create policy document_files_bucket_select on storage.objects for select
  using (
    bucket_id = 'document-files'
    and exists (
      select 1 from documents d
      where d.id::text = (storage.foldername(name))[3]
    )
  );

create policy document_files_bucket_insert on storage.objects for insert
  with check (
    bucket_id = 'document-files'
    and exists (
      select 1 from documents d
      where d.id::text = (storage.foldername(name))[3]
        and d.status = 'draft'
        and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

create policy document_files_bucket_delete on storage.objects for delete
  using (
    bucket_id = 'document-files'
    and exists (
      select 1 from documents d
      where d.id::text = (storage.foldername(name))[3]
        and d.status = 'draft'
        and (d.created_by = auth.uid() or fn_is_admin_role())
    )
  );

-- =====================================================================
-- generated-certificates: só leitura por enquanto (mesma visibilidade do
-- documento pai). Sem policy de insert para authenticated — de propósito:
-- a geração do PDF é reservada para uma futura Edge Function com
-- service_role (estrutura preparada na Etapa 11), nunca escrita direta
-- pelo cliente.
-- =====================================================================

create policy generated_certificates_bucket_select on storage.objects for select
  using (
    bucket_id = 'generated-certificates'
    and exists (
      select 1 from documents d
      where d.id::text = (storage.foldername(name))[3]
    )
  );
