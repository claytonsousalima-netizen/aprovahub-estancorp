-- =====================================================================
-- AprovaHub Estancorp — Etapa 2: dados de referência (opcional)
-- Não depende de autenticação. Idempotente (pode rodar mais de uma vez).
-- =====================================================================

insert into companies (name, slug)
values ('Estancorp', 'estancorp')
on conflict (slug) do nothing;

insert into hotels (company_id, name, code)
select c.id, h.name, h.code
from companies c
cross join (values
  ('Gran Estanplaza Berrini', 'GRB'),
  ('Estanplaza Berrini', 'EBR'),
  ('Estanplaza Funchal', 'EFU'),
  ('Estanplaza International', 'EIN'),
  ('Estanplaza Ibirapuera', 'EIB'),
  ('Estanplaza Nações', 'ENA'),
  ('Estanplaza Paulista', 'EPA'),
  ('Pulso Faria Lima', 'PFL')
) as h(name, code)
where c.slug = 'estancorp'
on conflict (company_id, code) do nothing;

insert into approval_types (company_id, code, name, description)
select c.id, t.code, t.name, t.description
from companies c
cross join (values
  ('cotacao', 'Cotação', 'Aprovação de orçamentos e compras'),
  ('diarista', 'Diarista', 'Contratação de diaristas'),
  ('locacao', 'Locação', 'Locação de utensílios e equipamentos'),
  ('compra', 'Compra', 'Compras administrativas diversas'),
  ('contrato', 'Contrato', 'Contratos administrativos e comerciais'),
  ('outros', 'Outros', 'Demais documentos administrativos')
) as t(code, name, description)
where c.slug = 'estancorp'
on conflict (company_id, code) do nothing;
