export function openModal(innerHtml) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg on';
  bg.innerHTML = `<div class="modal">${innerHtml}</div>`;
  document.body.appendChild(bg);

  function close() {
    bg.remove();
  }

  bg.addEventListener('click', (e) => {
    if (e.target === bg) close();
  });

  return { modal: bg.querySelector('.modal'), close };
}
