import { renderAppLayout } from '../components/app-sidebar.js';
import { getProfile } from '../auth/session.js';
import { toast } from '../components/toast.js';
import { navigate } from '../routes/router.js';
import { ROLE_LABEL } from '../constants/roles.js';
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  validateFile,
  fetchApprovalTypes,
  fetchMyHotels,
  previewApprovalRoute,
  createDraftDocument,
  uploadDocumentFile,
  addInternalNote,
  submitDocument,
} from '../services/documents.service.js';

const BLOCKED_ROLES = ['auditor', 'juridico', 'financeiro'];

// Máscara "centavos primeiro": cada dígito digitado empurra os anteriores
// para a esquerda, como numa calculadora — os 2 últimos dígitos sempre são
// os centavos. Formata com ponto de milhar e vírgula decimal (pt-BR).
function formatAmountDisplay(rawValue) {
  const digits = String(rawValue).replace(/\D/g, '');
  const cents = parseInt(digits || '0', 10);
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseAmountToNumber(displayValue) {
  const digits = String(displayValue).replace(/\D/g, '');
  return parseInt(digits || '0', 10) / 100;
}

// Só os campos de texto/seleção — os arquivos em si (File objects) não dá
// pra guardar no localStorage nem repor num <input type="file"> depois
// (o navegador bloqueia isso por segurança), então o rascunho cobre o que
// mais dói perder: o texto já digitado. Chave por usuário pra não vazar
// rascunho de uma conta pra outra num computador compartilhado.
function draftKey(profile) {
  return `aprovahub_draft_nova_solicitacao_${profile.id}`;
}

function saveDraft(profile, data) {
  try {
    localStorage.setItem(draftKey(profile), JSON.stringify(data));
  } catch {
    // localStorage indisponível (modo privado, quota etc.) — só não salva.
  }
}

function loadDraft(profile) {
  try {
    const raw = localStorage.getItem(draftKey(profile));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Hotel não conta como "preenchido" aqui: com um só hotel vinculado ele já
// vem pré-selecionado sozinho (sem ação do usuário), então um rascunho que
// só tem hotelId não representa nada que valha a pena avisar/restaurar.
function isDraftMeaningful(draft) {
  if (!draft) return false;
  return !!(
    draft.title?.trim() ||
    draft.description?.trim() ||
    draft.costCenter?.trim() ||
    draft.supplier?.trim() ||
    draft.internalNotes?.trim() ||
    draft.typeId ||
    (draft.amount && parseAmountToNumber(draft.amount) > 0)
  );
}

function clearDraft(profile) {
  try {
    localStorage.removeItem(draftKey(profile));
  } catch {
    // ignora
  }
}

export function renderNovaSolicitacao() {
  const profile = getProfile();

  if (BLOCKED_ROLES.includes(profile?.role_global)) {
    const blocked = document.createElement('div');
    blocked.innerHTML = `
      <div class="topbar"><div><h1>Nova solicitação</h1></div></div>
      <div class="card empty" style="padding:60px 20px">
        <b>Sem permissão</b>
        <p>Seu papel (${ROLE_LABEL[profile.role_global] || profile.role_global}) não pode criar solicitações, apenas consultar.</p>
      </div>
    `;
    return renderAppLayout('nova-solicitacao', blocked);
  }

  const content = document.createElement('div');
  content.innerHTML = `
    <div class="topbar">
      <div><h1>Nova solicitação</h1><div class="sub">Envie um documento para o fluxo de aprovação</div></div>
    </div>

    <div class="notice" id="draftNotice" style="display:none">
      📝 Rascunho restaurado do preenchimento anterior. <a href="#" id="btnDiscardDraft">Descartar e começar do zero</a>.
    </div>

    <div class="card" style="padding:20px;margin-bottom:16px">
      <h3 style="margin-bottom:12px">Tipo de solicitação *</h3>
      <div class="type-picker" id="typePicker"><div class="empty" style="padding:12px">Carregando tipos…</div></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:16px">
      <div class="form-grid">
        <div class="field">
          <label>Hotel/unidade *</label>
          <select id="fHotel"><option value="">Carregando…</option></select>
        </div>
        <div class="field">
          <label>Valor total (R$) *</label>
          <input type="text" inputmode="decimal" id="fAmount" placeholder="0,00">
        </div>
        <div class="field full">
          <label>Título *</label>
          <input id="fTitle" placeholder="Ex.: Compra de utensílios de cozinha">
        </div>
        <div class="field">
          <label>Centro de custo</label>
          <input id="fCostCenter" placeholder="Opcional">
        </div>
        <div class="field">
          <label>Fornecedor/prestador</label>
          <input id="fSupplier" placeholder="Opcional">
        </div>
        <div class="field full">
          <label>Descrição/justificativa</label>
          <textarea id="fDescription" placeholder="Explique o motivo da solicitação"></textarea>
        </div>
        <div class="field full">
          <label>Observações internas</label>
          <textarea id="fInternalNotes" placeholder="Visível só para a equipe interna, não aparece para o solicitante em outras contas"></textarea>
        </div>
      </div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:16px">
      <h3 style="margin-bottom:6px">Anexos *</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px">PDF, XLS, XLSX, DOC, DOCX, PNG, JPG ou JPEG — até ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB por arquivo.</p>
      <div class="dropzone">
        <div>Arraste arquivos aqui ou</div>
        <button type="button" id="btnPickFiles">selecionar arquivos</button>
        <input type="file" id="fFiles" multiple accept="${ALLOWED_EXTENSIONS.map((e) => '.' + e).join(',')}" style="display:none">
      </div>
      <div id="fileList"></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:16px">
      <h3 style="margin-bottom:10px">Prévia da rota de aprovação</h3>
      <div class="route-preview" id="routePreview">
        <div class="rp-t">Preencha hotel, tipo e valor para ver a rota</div>
      </div>
    </div>

    <div id="formError" style="color:var(--danger);font-size:12.5px;margin-bottom:14px;display:none"></div>
    <button class="btn btn-brass" id="btnSubmit">Enviar solicitação</button>
  `;

  const state = {
    types: [],
    hotels: [],
    selectedTypeId: null,
    files: [],
    draftId: null,
    uploadedFileCount: 0,
    internalNoteAdded: false,
    submitting: false,
  };

  const typePicker = content.querySelector('#typePicker');
  const hotelSelect = content.querySelector('#fHotel');
  const amountInput = content.querySelector('#fAmount');
  const fileInput = content.querySelector('#fFiles');
  const fileListEl = content.querySelector('#fileList');
  const routePreviewEl = content.querySelector('#routePreview');
  const errorBox = content.querySelector('#formError');
  const btnSubmit = content.querySelector('#btnSubmit');
  const draftNotice = content.querySelector('#draftNotice');
  const titleInput = content.querySelector('#fTitle');
  const costCenterInput = content.querySelector('#fCostCenter');
  const supplierInput = content.querySelector('#fSupplier');
  const descriptionInput = content.querySelector('#fDescription');
  const internalNotesInput = content.querySelector('#fInternalNotes');

  function persistDraft() {
    // Nunca salva depois que o envio já começou — nesse ponto o rascunho
    // em si já virou um documento real no banco (state.draftId).
    if (state.draftId) return;
    saveDraft(profile, {
      title: titleInput.value,
      costCenter: costCenterInput.value,
      supplier: supplierInput.value,
      description: descriptionInput.value,
      internalNotes: internalNotesInput.value,
      amount: amountInput.value,
      hotelId: hotelSelect.value,
      typeId: state.selectedTypeId,
    });
  }

  [titleInput, costCenterInput, supplierInput, descriptionInput, internalNotesInput].forEach((el) => {
    el.addEventListener('input', persistDraft);
  });

  content.querySelector('#btnDiscardDraft').addEventListener('click', (e) => {
    e.preventDefault();
    clearDraft(profile);
    [titleInput, costCenterInput, supplierInput, descriptionInput, internalNotesInput, amountInput].forEach((el) => (el.value = ''));
    hotelSelect.value = '';
    selectType(null);
    draftNotice.style.display = 'none';
    toast('🗑 Rascunho descartado');
  });

  content.querySelector('#btnPickFiles').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (state.draftId) {
      toast('⚠ O envio já começou. Aguarde concluir ou tente novamente para adicionar mais arquivos.');
      fileInput.value = '';
      return;
    }
    for (const file of fileInput.files) {
      const error = validateFile(file);
      if (error) {
        toast(`⚠ ${file.name}: ${error}`);
        continue;
      }
      state.files.push(file);
    }
    fileInput.value = '';
    renderFileList();
  });

  hotelSelect.addEventListener('change', () => {
    refreshRoutePreview();
    persistDraft();
  });
  amountInput.addEventListener('input', () => {
    amountInput.value = formatAmountDisplay(amountInput.value);
    refreshRoutePreview();
    persistDraft();
  });

  function renderFileList() {
    if (!state.files.length) {
      fileListEl.innerHTML = '';
      return;
    }
    // Depois que o envio começa, a lista de arquivos trava: removê-los
    // bagunçaria a numeração (file_order) dos que já foram enviados a uma
    // tentativa anterior parcialmente concluída.
    const locked = !!state.draftId;
    fileListEl.innerHTML = state.files
      .map(
        (f, i) => `
      <div class="file-item" data-i="${i}">
        <div class="fnum">${i + 1}</div>
        <div><b>${f.name}</b><br><span>${(f.size / 1024).toFixed(0)} KB</span></div>
        ${locked ? '' : '<button type="button" class="btn-remove-file">Remover</button>'}
      </div>`
      )
      .join('');
    fileListEl.querySelectorAll('.btn-remove-file').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.closest('[data-i]').dataset.i);
        state.files.splice(i, 1);
        renderFileList();
      });
    });
  }

  async function refreshRoutePreview() {
    const hotelId = hotelSelect.value;
    const amount = parseAmountToNumber(amountInput.value);
    if (!hotelId || !state.selectedTypeId || !(amount > 0)) {
      routePreviewEl.innerHTML = '<div class="rp-t">Preencha hotel, tipo e valor para ver a rota</div>';
      return;
    }
    try {
      const result = await previewApprovalRoute({
        companyId: profile.company_id,
        hotelId,
        approvalTypeId: state.selectedTypeId,
        amount,
      });
      if (!result || !result.steps.length) {
        routePreviewEl.innerHTML = '<div class="rp-t">⚠ Nenhuma regra de alçada cobre esse hotel/tipo/valor. Contate o administrador.</div>';
        return;
      }
      routePreviewEl.innerHTML = `
        <div class="rp-t">Rota de aprovação (${result.steps.length} etapa${result.steps.length > 1 ? 's' : ''})</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${result.steps
            .map(
              (s, i) => `<span class="badge b-draft">${i + 1}. ${ROLE_LABEL[s.role_required] || s.role_required}</span>`
            )
            .join('<span style="color:var(--muted)">→</span>')}
        </div>
      `;
    } catch (err) {
      routePreviewEl.innerHTML = `<div class="rp-t">⚠ ${err.message}</div>`;
    }
  }

  function selectType(typeId) {
    state.selectedTypeId = typeId;
    typePicker.querySelectorAll('.type-opt').forEach((el) => {
      el.classList.toggle('sel', el.dataset.id === typeId);
    });
    refreshRoutePreview();
    persistDraft();
  }

  async function loadOptions() {
    try {
      const [types, hotels] = await Promise.all([fetchApprovalTypes(), fetchMyHotels(profile)]);
      state.types = types;
      state.hotels = hotels;

      typePicker.innerHTML = types.length
        ? types
            .map(
              (t) => `<button type="button" class="type-opt" data-id="${t.id}"><b>${t.name}</b><span>${t.description || ''}</span></button>`
            )
            .join('')
        : '<div class="empty" style="padding:12px">Nenhum tipo de aprovação cadastrado.</div>';

      typePicker.querySelectorAll('.type-opt').forEach((btn) => {
        btn.addEventListener('click', () => selectType(btn.dataset.id));
      });

      // Com um só hotel vinculado não há nada a escolher de fato — mostra
      // ele já selecionado, sem a opção "Selecione…" no meio do caminho.
      hotelSelect.innerHTML =
        hotels.length === 0
          ? '<option value="">Nenhum hotel disponível</option>'
          : hotels.length === 1
            ? `<option value="${hotels[0].id}">${hotels[0].name} (${hotels[0].code})</option>`
            : `<option value="">Selecione…</option>${hotels.map((h) => `<option value="${h.id}">${h.name} (${h.code})</option>`).join('')}`;

      applyDraftAfterOptionsLoaded();
      if (hotels.length === 1) refreshRoutePreview();
    } catch (err) {
      toast(`⚠ ${err.message}`);
    }
  }

  // Campos de texto/valor não dependem de tipos/hotéis carregados, então
  // já entram assim que a tela monta. Hotel e tipo só dão pra selecionar
  // depois que loadOptions() preenche as opções (senão o value não existe
  // ainda no <select>/nos botões).
  const rawDraft = loadDraft(profile);
  const restoredDraft = isDraftMeaningful(rawDraft) ? rawDraft : null;
  if (rawDraft && !restoredDraft) {
    // Só tinha hotel (pré-selecionado sozinho) ou lixo de uma sessão
    // anterior — não é um rascunho de verdade, então nem avisa nem restaura.
    clearDraft(profile);
  }
  if (restoredDraft) {
    titleInput.value = restoredDraft.title || '';
    costCenterInput.value = restoredDraft.costCenter || '';
    supplierInput.value = restoredDraft.supplier || '';
    descriptionInput.value = restoredDraft.description || '';
    internalNotesInput.value = restoredDraft.internalNotes || '';
    amountInput.value = restoredDraft.amount || '';
    draftNotice.style.display = 'block';
  }

  function applyDraftAfterOptionsLoaded() {
    if (!restoredDraft) return;
    if (restoredDraft.hotelId) hotelSelect.value = restoredDraft.hotelId;
    if (restoredDraft.typeId) selectType(restoredDraft.typeId);
    refreshRoutePreview();
  }

  loadOptions();

  btnSubmit.addEventListener('click', () => handleSubmit());

  async function handleSubmit() {
    if (state.submitting) return;

    const title = content.querySelector('#fTitle').value.trim();
    const costCenter = content.querySelector('#fCostCenter').value.trim();
    const supplier = content.querySelector('#fSupplier').value.trim();
    const description = content.querySelector('#fDescription').value.trim();
    const internalNotes = content.querySelector('#fInternalNotes').value.trim();
    const hotelId = hotelSelect.value;
    const amount = parseAmountToNumber(amountInput.value);

    const errors = [];
    if (!state.selectedTypeId) errors.push('Selecione o tipo de solicitação.');
    if (!hotelId) errors.push('Selecione o hotel/unidade.');
    if (!title) errors.push('Informe o título.');
    if (!(amount > 0)) errors.push('Informe um valor total maior que zero.');
    if (!state.files.length) errors.push('Anexe ao menos um arquivo.');

    if (errors.length) {
      errorBox.textContent = errors.join(' ');
      errorBox.style.display = 'block';
      return;
    }

    errorBox.style.display = 'none';
    state.submitting = true;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviando…';

    try {
      let document = state.draftId ? { id: state.draftId } : null;

      if (!document) {
        document = await createDraftDocument({
          companyId: profile.company_id,
          hotelId,
          approvalTypeId: state.selectedTypeId,
          title,
          description,
          supplierName: supplier,
          costCenter,
          amount,
          createdBy: profile.id,
        });
        state.draftId = document.id;
        // A partir daqui, uma nova tentativa reaproveita este rascunho — os
        // campos que definem a rota de aprovação não podem mais mudar.
        hotelSelect.disabled = true;
        amountInput.disabled = true;
        typePicker.querySelectorAll('.type-opt').forEach((el) => (el.disabled = true));
        renderFileList();
      }

      if (internalNotes && !state.internalNoteAdded) {
        await addInternalNote({ documentId: document.id, userId: profile.id, comment: internalNotes });
        state.internalNoteAdded = true;
      }

      // Retomável: se uma tentativa anterior falhou no meio do upload, só
      // envia os arquivos que ainda não foram gravados, em vez de duplicá-los.
      for (let i = state.uploadedFileCount; i < state.files.length; i++) {
        await uploadDocumentFile({ document, file: state.files[i], order: i + 1, userId: profile.id });
        state.uploadedFileCount = i + 1;
      }

      await submitDocument(document.id);

      clearDraft(profile);
      toast('✅ Solicitação enviada para aprovação');
      navigate('dashboard');
    } catch (err) {
      errorBox.textContent = `⚠ ${err.message} — seus dados foram mantidos, você pode tentar enviar de novo.`;
      errorBox.style.display = 'block';
    } finally {
      state.submitting = false;
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Enviar solicitação';
    }
  }

  return renderAppLayout('nova-solicitacao', content);
}
