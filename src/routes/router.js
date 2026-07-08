const views = new Map();

function parseHash() {
  const raw = location.hash.slice(1) || 'login';
  const [view, param] = raw.split('/');
  return { view, param };
}

function render() {
  const { view, param } = parseHash();
  const root = document.getElementById('app-root');
  const renderView = views.get(view);

  if (!renderView) {
    root.replaceChildren(placeholder(view));
    return;
  }
  root.replaceChildren(renderView(param));
}

function placeholder(view) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.style.padding = '80px 20px';
  // Um link de e-mail do Supabase (convite/recuperação) pode aterrissar
  // aqui por uma fração de segundo antes do app processá-lo e navegar
  // para o lugar certo — nesse caso mostramos uma mensagem neutra em vez
  // de "Em construção", que soa como um beco sem saída permanente.
  const isAuthCallback = view.includes('access_token=') || view.includes('error=');
  div.innerHTML = isAuthCallback
    ? '<b>Só um instante…</b><p>Processando seu link de acesso.</p>'
    : `<b>Em construção</b><p>A tela "${view}" será implementada em uma próxima etapa.</p>`;
  return div;
}

export function registerView(name, renderFn) {
  views.set(name, renderFn);
}

export function hasView(name) {
  return views.has(name);
}

export function navigate(view, param) {
  location.hash = param ? `${view}/${param}` : view;
}

// Re-renderiza a tela indicada pelo hash atual da URL, sem trocar o hash —
// usado quando a sessão é reavaliada (ex.: app reiniciando porque o
// navegador recarregou a aba em segundo plano) mas o usuário já estava numa
// tela válida: evita o "salto" para a rota padrão do perfil por cima do que
// já estava na barra de endereço.
export function renderCurrentHash() {
  render();
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}
