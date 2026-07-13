-- =====================================================================
-- AprovaHub Estancorp — só um super_admin pode conceder "Papel no Hotel"
-- = super_admin (mesmo princípio da migração 0023, aplicado agora a
-- hotel_users.role_hotel em vez de profiles.role_global).
--
-- Lacuna encontrada: hotel_users_insert/update permitiam qualquer
-- role_hotel, incluindo 'super_admin', pra admin_corporativo e até
-- admin_hotel (com acesso àquele hotel) — nenhum dos dois deveria poder
-- conceder esse papel a ninguém, em hotel nenhum.
-- =====================================================================

drop policy if exists hotel_users_insert on hotel_users;
create policy hotel_users_insert on hotel_users for insert
  with check (
    fn_is_super_admin()
    or (
      role_hotel <> 'super_admin'
      and (
        (fn_is_admin_role() and exists (select 1 from hotels h where h.id = hotel_id and h.company_id = fn_my_company_id()))
        or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_id))
      )
    )
  );

drop policy if exists hotel_users_update on hotel_users;
create policy hotel_users_update on hotel_users for update
  using (
    fn_is_super_admin()
    or (
      hotel_users.role_hotel <> 'super_admin'
      and (
        (fn_is_admin_role() and exists (select 1 from hotels h where h.id = hotel_users.hotel_id and h.company_id = fn_my_company_id()))
        or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_users.hotel_id))
      )
    )
  )
  with check (
    fn_is_super_admin()
    or (
      role_hotel <> 'super_admin'
      and (
        (fn_is_admin_role() and exists (select 1 from hotels h where h.id = hotel_id and h.company_id = fn_my_company_id()))
        or (fn_my_role() = 'admin_hotel' and fn_has_hotel_access(hotel_id))
      )
    )
  );
