export const ROLES = [
  ['super_admin', 'Super admin'],
  ['admin_corporativo', 'Admin corporativo'],
  ['admin_hotel', 'Admin hotel'],
  ['solicitante', 'Solicitante'],
  ['lider_area', 'Líder da área'],
  ['lider_administrativo', 'Líder administrativo'],
  ['gerente_geral', 'Gerente geral'],
  ['juridico', 'Jurídico'],
];

export const ROLE_LABEL = Object.fromEntries(ROLES);

// Só quem já é super_admin concede o papel super_admin — pra qualquer
// outra pessoa (Papel Global no cadastro do usuário, ou Papel no Hotel
// no vínculo usuário x hotel), essa opção nem aparece no seletor. O
// banco também impede isso (migrações 0023 e 0024), então isto aqui é
// só pra não sugerir uma ação que o servidor rejeitaria.
export function selectableRoles(profile) {
  return profile?.role_global === 'super_admin' ? ROLES : ROLES.filter(([v]) => v !== 'super_admin');
}
