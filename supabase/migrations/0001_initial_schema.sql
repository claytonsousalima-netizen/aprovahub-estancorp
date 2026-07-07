-- =====================================================================
-- AprovaHub Estancorp — Etapa 2: Modelagem inicial do banco
-- Execute este script inteiro, uma única vez, no SQL Editor do Supabase.
-- RLS é habilitada em todas as tabelas ao final, SEM policies ainda:
-- isso bloqueia todo acesso via anon/authenticated por padrão (fail-closed)
-- até a Etapa 3, quando Auth + policies entram juntas.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. ENUMS
-- =====================================================================

do $$ begin
  create type user_role as enum (
    'super_admin','admin_corporativo','admin_hotel','solicitante',
    'lider_area','lider_administrativo','gerente_geral',
    'financeiro','auditor','juridico'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_status as enum (
    'draft','pending','approved','rejected','cancelled','expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type step_status as enum (
    'pending','approved','rejected','skipped','cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_action as enum (
    'view','approve','reject','download','certificate_generated',
    'resend_notification','admin_change'
  );
exception when duplicate_object then null; end $$;

-- =====================================================================
-- 2. TABELAS
-- =====================================================================

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists hotels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint hotels_company_code_uniq unique (company_id, code)
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  full_name text not null,
  email text not null unique,
  phone text,
  role_global user_role not null default 'solicitante',
  active boolean not null default true,
  mfa_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hotel_users (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role_hotel user_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint hotel_users_uniq unique (hotel_id, user_id)
);

create table if not exists approval_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  active boolean not null default true,
  constraint approval_types_company_code_uniq unique (company_id, code)
);

create table if not exists approval_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  hotel_id uuid references hotels(id) on delete cascade,
  approval_type_id uuid references approval_types(id) on delete cascade,
  min_amount numeric(14,2) not null default 0,
  max_amount numeric(14,2),
  requires_level_1 boolean not null default true,
  requires_level_2 boolean not null default true,
  requires_level_3 boolean not null default false,
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_rules_amount_check check (max_amount is null or max_amount > min_amount)
);

create table if not exists approval_rule_steps (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references approval_rules(id) on delete cascade,
  step_order integer not null check (step_order > 0),
  role_required user_role not null,
  approval_mode text not null default 'single' check (approval_mode in ('single','any_of','all_of')),
  required_user_id uuid references profiles(id),
  sla_hours integer,
  active boolean not null default true,
  constraint approval_rule_steps_uniq unique (rule_id, step_order)
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  hotel_id uuid not null references hotels(id) on delete cascade,
  approval_type_id uuid not null references approval_types(id),
  title text not null,
  description text,
  supplier_name text,
  cost_center text,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'BRL',
  status document_status not null default 'draft',
  created_by uuid not null references profiles(id),
  current_step_order integer not null default 1,
  final_decision_at timestamptz,
  final_hash text,
  certificate_number text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  file_sha256 text,
  file_order integer not null default 1,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint document_files_uniq_order unique (document_id, file_order)
);

create table if not exists document_approval_steps (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  step_order integer not null,
  role_required user_role not null,
  assigned_user_id uuid references profiles(id),
  status step_status not null default 'pending',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  rejected_by uuid references profiles(id),
  rejected_at timestamptz,
  rejection_reason text,
  evidence_id uuid,
  created_at timestamptz not null default now(),
  constraint document_approval_steps_uniq unique (document_id, step_order)
);

create table if not exists approval_evidences (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  approval_step_id uuid references document_approval_steps(id) on delete set null,
  user_id uuid not null references profiles(id),
  action evidence_action not null,
  action_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  geo_lat numeric(9,6),
  geo_lng numeric(9,6),
  auth_method text,
  mfa_verified boolean not null default false,
  password_reconfirmed boolean not null default false,
  document_hash_before text,
  document_hash_after text,
  evidence_hash text not null,
  previous_evidence_hash text,
  created_at timestamptz not null default now()
);
comment on table approval_evidences is
  'Trilha de auditoria append-only. Cada linha encadeia com a anterior via previous_evidence_hash (ver fn_chain_evidence_hash). UPDATE/DELETE são bloqueados por trigger.';

-- referência circular resolvida depois que approval_evidences existe
alter table document_approval_steps
  add constraint document_approval_steps_evidence_fk
  foreign key (evidence_id) references approval_evidences(id) on delete set null;

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  actor_user_id uuid references profiles(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  type text not null,
  title text not null,
  message text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists document_comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null references profiles(id),
  comment text not null,
  internal_only boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists signing_sessions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  approval_step_id uuid not null references document_approval_steps(id) on delete cascade,
  user_id uuid not null references profiles(id),
  status text not null default 'pending' check (status in ('pending','verified','expired','cancelled')),
  challenge_type text not null check (challenge_type in ('totp','email_otp','password_reconfirm','sms_otp')),
  challenge_sent_at timestamptz,
  challenge_verified_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 3. ÍNDICES
-- =====================================================================

create index if not exists idx_hotels_company on hotels(company_id);
create index if not exists idx_profiles_company on profiles(company_id);
create index if not exists idx_hotel_users_hotel on hotel_users(hotel_id);
create index if not exists idx_hotel_users_user on hotel_users(user_id);
create index if not exists idx_approval_types_company on approval_types(company_id);
create index if not exists idx_approval_rules_company on approval_rules(company_id);
create index if not exists idx_approval_rules_hotel on approval_rules(hotel_id);
create index if not exists idx_approval_rules_type on approval_rules(approval_type_id);
create index if not exists idx_approval_rule_steps_rule on approval_rule_steps(rule_id);
create index if not exists idx_documents_company on documents(company_id);
create index if not exists idx_documents_hotel on documents(hotel_id);
create index if not exists idx_documents_type on documents(approval_type_id);
create index if not exists idx_documents_status on documents(status);
create index if not exists idx_documents_created_by on documents(created_by);
create index if not exists idx_documents_created_at on documents(created_at desc);
create index if not exists idx_document_files_document on document_files(document_id);
create index if not exists idx_document_approval_steps_document on document_approval_steps(document_id);
create index if not exists idx_document_approval_steps_assignee on document_approval_steps(assigned_user_id, status);
create index if not exists idx_approval_evidences_document on approval_evidences(document_id);
create index if not exists idx_approval_evidences_document_chain on approval_evidences(document_id, created_at desc, id desc);
create index if not exists idx_approval_evidences_step on approval_evidences(approval_step_id);
create index if not exists idx_approval_evidences_user on approval_evidences(user_id);
create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_company on audit_logs(company_id);
create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);
create index if not exists idx_notifications_user on notifications(user_id, read_at);
create index if not exists idx_document_comments_document on document_comments(document_id);
create index if not exists idx_signing_sessions_document on signing_sessions(document_id);
create index if not exists idx_signing_sessions_user on signing_sessions(user_id);

-- =====================================================================
-- 4. TRIGGERS DE updated_at
-- =====================================================================

create or replace function fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function fn_set_updated_at();

drop trigger if exists trg_approval_rules_updated_at on approval_rules;
create trigger trg_approval_rules_updated_at
  before update on approval_rules
  for each row execute function fn_set_updated_at();

drop trigger if exists trg_documents_updated_at on documents;
create trigger trg_documents_updated_at
  before update on documents
  for each row execute function fn_set_updated_at();

-- =====================================================================
-- 5. FUNÇÕES DE NEGÓCIO
-- =====================================================================

-- 5.1 Próximo passo pendente de um documento
create or replace function fn_next_pending_step(p_document_id uuid)
returns document_approval_steps
language sql
stable
security definer
set search_path = public
as $$
  select *
  from document_approval_steps
  where document_id = p_document_id and status = 'pending'
  order by step_order asc
  limit 1;
$$;

-- 5.2 Verifica se um usuário pode aprovar o próximo passo pendente do documento
create or replace function fn_can_user_approve(p_document_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc documents%rowtype;
  v_step document_approval_steps%rowtype;
  v_has_role boolean;
begin
  select * into v_doc from documents where id = p_document_id;
  if not found or v_doc.status <> 'pending' then
    return false;
  end if;

  select * into v_step from fn_next_pending_step(p_document_id);
  if v_step.id is null then
    return false;
  end if;

  if v_step.assigned_user_id is not null then
    return v_step.assigned_user_id = p_user_id;
  end if;

  select exists (
    select 1 from profiles p
    where p.id = p_user_id and p.active and p.role_global = v_step.role_required
  ) or exists (
    select 1 from hotel_users hu
    where hu.user_id = p_user_id and hu.hotel_id = v_doc.hotel_id
      and hu.active and hu.role_hotel = v_step.role_required
  ) into v_has_role;

  return coalesce(v_has_role, false);
end;
$$;

revoke all on function fn_next_pending_step(uuid) from public;
revoke all on function fn_can_user_approve(uuid, uuid) from public;
grant execute on function fn_next_pending_step(uuid) to authenticated;
grant execute on function fn_can_user_approve(uuid, uuid) to authenticated;

-- 5.3 Geração de número de certificado sequencial por ano
create sequence if not exists certificate_number_seq;

create or replace function fn_generate_certificate_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'AH-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('certificate_number_seq')::text, 6, '0');
$$;

revoke all on function fn_generate_certificate_number() from public, anon, authenticated;

-- 5.4 Registro de evidência (uso interno — chamada por futuras RPCs de aprovação/rejeição,
-- nunca diretamente pelo cliente). SECURITY DEFINER para poder inserir em approval_evidences
-- independentemente das policies de RLS que serão aplicadas na Etapa 3.
create or replace function fn_record_evidence(
  p_document_id uuid,
  p_approval_step_id uuid,
  p_user_id uuid,
  p_action evidence_action,
  p_ip_address inet,
  p_user_agent text,
  p_auth_method text,
  p_mfa_verified boolean,
  p_password_reconfirmed boolean,
  p_document_hash_before text,
  p_document_hash_after text
)
returns approval_evidences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row approval_evidences;
begin
  insert into approval_evidences (
    document_id, approval_step_id, user_id, action, ip_address, user_agent,
    auth_method, mfa_verified, password_reconfirmed,
    document_hash_before, document_hash_after
  ) values (
    p_document_id, p_approval_step_id, p_user_id, p_action, p_ip_address, p_user_agent,
    p_auth_method, p_mfa_verified, p_password_reconfirmed,
    p_document_hash_before, p_document_hash_after
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function fn_record_evidence(uuid, uuid, uuid, evidence_action, inet, text, text, boolean, boolean, text, text) from public, anon, authenticated;

-- 5.5 Encadeamento de hash (cadeia de custódia) — roda antes de cada insert em approval_evidences
create or replace function fn_chain_evidence_hash()
returns trigger
language plpgsql
as $$
declare
  v_prev_hash text;
  v_payload text;
begin
  select evidence_hash into v_prev_hash
  from approval_evidences
  where document_id = new.document_id
  order by created_at desc, id desc
  limit 1;

  new.previous_evidence_hash := v_prev_hash;
  new.action_at := coalesce(new.action_at, now());

  v_payload := coalesce(new.document_id::text,'') || '|' ||
               coalesce(new.approval_step_id::text,'') || '|' ||
               coalesce(new.user_id::text,'') || '|' ||
               coalesce(new.action::text,'') || '|' ||
               new.action_at::text || '|' ||
               coalesce(new.ip_address::text,'') || '|' ||
               coalesce(new.document_hash_before,'') || '|' ||
               coalesce(new.document_hash_after,'') || '|' ||
               coalesce(v_prev_hash, 'GENESIS');

  new.evidence_hash := encode(digest(v_payload, 'sha256'), 'hex');

  return new;
end;
$$;

drop trigger if exists trg_approval_evidences_chain on approval_evidences;
create trigger trg_approval_evidences_chain
  before insert on approval_evidences
  for each row execute function fn_chain_evidence_hash();

-- 5.6 Imutabilidade: bloqueia UPDATE e DELETE em approval_evidences
create or replace function fn_prevent_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'approval_evidences é append-only: % não é permitido (id %)', tg_op, old.id;
end;
$$;

drop trigger if exists trg_approval_evidences_no_update on approval_evidences;
create trigger trg_approval_evidences_no_update
  before update on approval_evidences
  for each row execute function fn_prevent_evidence_mutation();

drop trigger if exists trg_approval_evidences_no_delete on approval_evidences;
create trigger trg_approval_evidences_no_delete
  before delete on approval_evidences
  for each row execute function fn_prevent_evidence_mutation();

-- =====================================================================
-- 6. ROW LEVEL SECURITY (fail-closed — sem policies ainda)
-- =====================================================================
-- Todas as tabelas abaixo ficam com RLS habilitada e ZERO policies.
-- Resultado: nenhuma linha é visível/gravável via anon/authenticated
-- (chaves publicáveis) até a Etapa 3, quando Auth + policies chegam juntas.
-- O projeto já tem "Enable automatic RLS" ligado, então isso ocorre
-- automaticamente a cada CREATE TABLE — os comandos abaixo são apenas
-- para deixar explícito e portátil.

alter table companies enable row level security;
alter table hotels enable row level security;
alter table profiles enable row level security;
alter table hotel_users enable row level security;
alter table approval_types enable row level security;
alter table approval_rules enable row level security;
alter table approval_rule_steps enable row level security;
alter table documents enable row level security;
alter table document_files enable row level security;
alter table document_approval_steps enable row level security;
alter table approval_evidences enable row level security;
alter table audit_logs enable row level security;
alter table notifications enable row level security;
alter table document_comments enable row level security;
alter table signing_sessions enable row level security;
