-- =====================================================================
-- AprovaHub Estancorp — Etapa 6.1: auditoria automática de cadastros
-- administrativos. Toda alteração (INSERT/UPDATE/DELETE) nas tabelas de
-- cadastro gera uma linha em audit_logs, sem depender de nenhuma tela
-- lembrar de registrar isso — é impossível esquecer ou pular.
-- =====================================================================

create or replace function fn_admin_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_company_id uuid;
begin
  v_company_id := case
    when TG_TABLE_NAME = 'companies' then (v_row->>'id')::uuid
    else nullif(v_row->>'company_id', '')::uuid
  end;

  insert into audit_logs (company_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
  values (
    v_company_id,
    auth.uid(),
    TG_TABLE_NAME,
    (v_row->>'id')::uuid,
    lower(TG_OP),
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['companies','hotels','profiles','hotel_users','approval_types','approval_rules','approval_rule_steps']
  loop
    execute format('drop trigger if exists trg_%s_audit on %I;', t, t);
    execute format(
      'create trigger trg_%s_audit after insert or update or delete on %I for each row execute function fn_admin_audit_log();',
      t, t
    );
  end loop;
end $$;
