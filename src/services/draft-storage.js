// Rascunho da Nova solicitação, em localStorage — sobrevive a trocar de
// tela ou de janela (alt+tab), mas precisa sumir quando a sessão termina
// (logout), senão o rascunho de uma pessoa poderia aparecer pra outra no
// mesmo computador compartilhado. Chave por usuário; nunca guarda os
// arquivos em si (File objects não sobrevivem a localStorage nem dá pra
// repor num <input type="file"> depois, por segurança do navegador).
function draftKey(userId) {
  return `aprovahub_draft_nova_solicitacao_${userId}`;
}

export function saveDraft(userId, data) {
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify(data));
  } catch {
    // localStorage indisponível (modo privado, quota etc.) — só não salva.
  }
}

export function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDraft(userId) {
  try {
    localStorage.removeItem(draftKey(userId));
  } catch {
    // ignora
  }
}
