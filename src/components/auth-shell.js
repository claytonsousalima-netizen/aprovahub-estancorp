export function renderAuthShell(cardHtml) {
  const wrap = document.createElement('div');
  wrap.id = 'loginScreen';
  wrap.innerHTML = `
    <div class="login-left">
      <div class="brand">
        <div class="brand-mark">A</div>
        <div><b>AprovaHub</b><small>Estancorp · Governança de Aprovações</small></div>
      </div>
      <div class="login-hero">
        <h1>Aprovações sem papel, com <em>trilha completa</em> de evidências.</h1>
        <p>Cotações, contratação de diaristas e locações de utensílios aprovadas em fluxo eletrônico sequencial — com hash, IP, data e hora de cada assinatura.</p>
      </div>
      <div class="login-foot">AprovaHub · Estancorp</div>
    </div>
    <div class="login-right">
      <div class="login-card">${cardHtml}</div>
    </div>
  `;
  return wrap;
}
