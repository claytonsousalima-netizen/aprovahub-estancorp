import { supabase } from '../config/supabase.js';
import { renderAdminLayout } from '../components/admin-sidebar.js';
import { getProfile } from '../auth/session.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { ROLES, ROLE_LABEL } from '../constants/roles.js';

const fmt = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function renderAdminApprovalRules() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Regras de alçada</h1><div class="sub">Quem aprova, em que ordem, e a partir de qual valor</div></div>
      <button class="btn btn-brass" id="btnNew">+ Nova regra</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>Unidade</th><th>Tipo</th><th>Faixa de valor</th><th>Status</th><th></th></tr></thead>
      <tbody id="rulesBody"><tr><td colspan="5" class="empty">Carregando…</td></tr></tbody>
    </table></div>
  `;

  const profile = getProfile();
  const btnNew = content.querySelector('#btnNew');
  const tbody = content.querySelector('#rulesBody');
  const refresh = () => loadRules(tbody, profile);
  btnNew.addEventListener('click', () => openRuleForm(null, profile, refresh));

  refresh();

  return renderAdminLayout('admin-approval-rules', content);
}

async function loadRules(tbody, profile) {
  const { data, error } = await supabase
    .from('approval_rules')
    .select('*, hotels(name), approval_types(name)')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Erro ao carregar: ${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Nenhuma regra cadastrada.</td></tr>`;
    return;
  }

  const byId = new Map(data.map((r) => [r.id, r]));

  tbody.innerHTML = data
    .map(
      (r) => `
    <tr data-id="${r.id}">
      <td>${r.hotels?.name ?? '<i style="color:var(--muted)">Todas as unidades</i>'}</td>
      <td>${r.approval_types?.name ?? '<i style="color:var(--muted)">Todos os tipos</i>'}</td>
      <td>${fmt(r.min_amount)} ${r.max_amount ? '– ' + fmt(r.max_amount) : 'ou mais'}</td>
      <td>${
        r.active
          ? '<span class="badge b-ok"><span class="dot"></span>Ativa</span>'
          : '<span class="badge b-no"><span class="dot"></span>Inativa</span>'
      }</td>
      <td>
        <button class="btn btn-ghost btn-edit" style="padding:6px 10px">Editar</button>
        <button class="btn btn-ghost btn-steps" style="padding:6px 10px">Etapas</button>
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openRuleForm(byId.get(id), profile, () => loadRules(tbody, profile));
    });
  });

  tbody.querySelectorAll('.btn-steps').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openStepsManager(byId.get(id));
    });
  });
}

async function fetchManageableHotels(profile) {
  if (['super_admin', 'admin_corporativo'].includes(profile?.role_global)) {
    const { data } = await supabase.from('hotels').select('id, name').order('name');
    return data || [];
  }
  const { data } = await supabase
    .from('hotel_users')
    .select('hotels(id, name)')
    .eq('user_id', profile.id)
    .eq('active', true);
  return (data || []).map((r) => r.hotels).filter(Boolean);
}

async function openRuleForm(rule, profile, onSaved) {
  const isEdit = !!rule;
  const [hotels, typesResult] = await Promise.all([
    fetchManageableHotels(profile),
    supabase.from('approval_types').select('id, name').order('name'),
  ]);
  const types = typesResult.data || [];

  const { modal, close } = openModal(`
    <h3>${isEdit ? 'Editar regra' : 'Nova regra de alçada'}</h3>
    <div class="field">
      <label>Unidade</label>
      <select id="fHotel">
        <option value="">Todas as unidades</option>
        ${hotels.map((h) => `<option value="${h.id}" ${rule?.hotel_id === h.id ? 'selected' : ''}>${h.name}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="margin-top:12px">
      <label>Tipo de documento</label>
      <select id="fType">
        <option value="">Todos os tipos</option>
        ${types.map((t) => `<option value="${t.id}" ${rule?.approval_type_id === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
      </select>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><label>Valor mínimo (R$)</label><input type="number" min="0" step="0.01" id="fMin" value="${rule?.min_amount ?? 0}"></div>
      <div class="field"><label>Valor máximo (R$, vazio = sem limite)</label><input type="number" min="0" step="0.01" id="fMax" value="${rule?.max_amount ?? ''}"></div>
    </div>
    <div class="field" style="margin-top:12px"><label><input type="checkbox" id="fActive" ${rule?.active !== false ? 'checked' : ''}> Ativa</label></div>
    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="btnCancel">Cancelar</button>
      <button class="btn btn-ok" id="btnSave">Salvar</button>
    </div>
  `);

  modal.querySelector('#btnCancel').addEventListener('click', close);

  modal.querySelector('#btnSave').addEventListener('click', async () => {
    const hotel_id = modal.querySelector('#fHotel').value || null;
    const approval_type_id = modal.querySelector('#fType').value || null;
    const min_amount = parseFloat(modal.querySelector('#fMin').value || 0);
    const maxRaw = modal.querySelector('#fMax').value;
    const max_amount = maxRaw === '' ? null : parseFloat(maxRaw);
    const active = modal.querySelector('#fActive').checked;
    const errorBox = modal.querySelector('#formError');

    const payload = { hotel_id, approval_type_id, min_amount, max_amount, active };

    const { error } = isEdit
      ? await supabase.from('approval_rules').update(payload).eq('id', rule.id)
      : await supabase.from('approval_rules').insert({ ...payload, company_id: profile.company_id, created_by: profile.id });

    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = 'block';
      return;
    }

    close();
    toast(isEdit ? '✅ Regra atualizada' : '✅ Regra criada');
    onSaved();
  });
}

async function openStepsManager(rule) {
  const { modal, close } = openModal(`
    <h3>Etapas de aprovação</h3>
    <p style="font-size:12.5px;color:var(--muted)">Ordem em que a alçada é acionada, com aprovador específico (opcional) e prazo (SLA) por etapa.</p>
    <div id="stepsList" style="margin-bottom:14px">Carregando…</div>
    <div class="rule-row" style="border-top:1px dashed var(--line);padding-top:14px;margin-top:4px">
      <div style="width:100%">
        <div class="form-grid">
          <div class="field">
            <label>Papel exigido</label>
            <select id="fRole">${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          </div>
          <div class="field"><label>SLA (horas, opcional)</label><input type="number" min="1" id="fSla"></div>
        </div>
        <button class="btn btn-brass" id="btnAddStep" style="margin-top:10px">+ Adicionar etapa</button>
      </div>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="btnClose">Fechar</button></div>
  `);

  modal.querySelector('#btnClose').addEventListener('click', close);

  const stepsList = modal.querySelector('#stepsList');
  async function refreshSteps() {
    const { data, error } = await supabase
      .from('approval_rule_steps')
      .select('*')
      .eq('rule_id', rule.id)
      .order('step_order');

    if (error) {
      stepsList.innerHTML = `<div class="empty">Erro: ${error.message}</div>`;
      return;
    }
    if (!data.length) {
      stepsList.innerHTML = '<div class="empty" style="padding:16px">Nenhuma etapa configurada ainda.</div>';
      return;
    }
    stepsList.innerHTML = data
      .map(
        (s) => `
      <div class="rule-row" data-id="${s.id}">
        <div class="rn">${s.step_order}</div>
        <div><b>${ROLE_LABEL[s.role_required] || s.role_required}</b><span>${s.sla_hours ? `SLA: ${s.sla_hours}h` : 'Sem SLA definido'}</span></div>
        <button class="btn btn-ghost btn-remove-step" style="margin-left:auto;padding:6px 10px;color:var(--danger)">Remover</button>
      </div>`
      )
      .join('');

    stepsList.querySelectorAll('.btn-remove-step').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id;
        const { error: delError } = await supabase.from('approval_rule_steps').delete().eq('id', id);
        if (delError) {
          toast(`⚠ ${delError.message}`);
          return;
        }
        refreshSteps();
      });
    });
  }

  modal.querySelector('#btnAddStep').addEventListener('click', async () => {
    const role_required = modal.querySelector('#fRole').value;
    const slaRaw = modal.querySelector('#fSla').value;
    const sla_hours = slaRaw === '' ? null : parseInt(slaRaw, 10);

    const { data: existing } = await supabase
      .from('approval_rule_steps')
      .select('step_order')
      .eq('rule_id', rule.id)
      .order('step_order', { ascending: false })
      .limit(1);
    const nextOrder = existing?.length ? existing[0].step_order + 1 : 1;

    const { error } = await supabase
      .from('approval_rule_steps')
      .insert({ rule_id: rule.id, step_order: nextOrder, role_required, sla_hours });

    if (error) {
      toast(`⚠ ${error.message}`);
      return;
    }
    modal.querySelector('#fSla').value = '';
    refreshSteps();
  });

  refreshSteps();
}
