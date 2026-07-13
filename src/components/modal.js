export function openModal(innerHtml) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg on';
  bg.innerHTML = `<div class="modal">${innerHtml}</div>`;
  document.body.appendChild(bg);

  function close() {
    bg.remove();
  }

  // Clicar fora (no fundo escurecido) não fecha mais o modal — só os
  // botões explícitos (Cancelar/Salvar/etc. de cada formulário) chamam
  // close(). Evita perder o que já foi digitado por um clique acidental.

  return { modal: bg.querySelector('.modal'), close };
}
