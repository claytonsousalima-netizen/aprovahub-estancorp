let hideTimer = null;

export function toast(message, duration = 3200) {
  const el = document.getElementById('toast');
  el.innerHTML = message;
  el.classList.add('on');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('on'), duration);
}
