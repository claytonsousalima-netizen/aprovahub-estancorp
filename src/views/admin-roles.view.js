import { renderAdminLayout } from '../components/admin-sidebar.js';

const ROLE_INFO = [
  ['super_admin', 'Super admin', 'Acesso técnico total, em qualquer empresa cadastrada no portal. Uso restrito à equipe técnica.'],
  ['admin_corporativo', 'Admin corporativo', 'Administra a Estancorp inteira: empresas, hotéis, usuários, regras de alçada e parâmetros de segurança.'],
  ['admin_hotel', 'Admin hotel', 'Administra apenas os hotéis aos quais está vinculado — vê e gerencia vínculos/regras só das suas unidades.'],
  ['solicitante', 'Solicitante', 'Cria documentos de aprovação. Só vê os documentos que ele mesmo criou.'],
  ['lider_area', 'Líder da área', 'Aprova o nível 1 do fluxo, tipicamente vinculado a um hotel específico.'],
  ['lider_administrativo', 'Líder administrativo', 'Aprova o nível 2 do fluxo, tipicamente com alçada corporativa (todas as unidades).'],
  ['gerente_geral', 'Gerente geral', 'Aprova o nível 3 (GG), exigido acima do valor de alçada configurado.'],
  ['financeiro', 'Financeiro', 'Consulta, audita e exporta documentos. Só aprova se uma etapa exigir explicitamente o papel financeiro.'],
  ['auditor', 'Auditor', 'Acesso de somente leitura a todos os documentos e evidências da empresa — nunca altera nada.'],
  ['juridico', 'Jurídico', 'Consulta documentos e certificados de aprovação — acesso de somente leitura.'],
];

export function renderAdminRoles() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar"><div><h1>Perfis e permissões</h1><div class="sub">O que cada papel pode fazer no portal</div></div></div>
    <div class="notice">💡 Papéis são fixos no sistema (não são cadastros editáveis). Para mudar o papel de alguém, use a tela <b>Usuários</b>.</div>
    <div class="card">
      ${ROLE_INFO.map(
        ([code, label, desc]) => `
        <div class="rule-row">
          <div class="rn mono" style="font-size:10px">${code.slice(0, 2).toUpperCase()}</div>
          <div><b>${label}</b><span>${desc}</span></div>
        </div>`
      ).join('')}
    </div>
  `;

  return renderAdminLayout('admin-roles', content);
}
