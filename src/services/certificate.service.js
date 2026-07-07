// Estrutura pensada para, no futuro, uma Edge Function gerar o PDF de
// verdade: hoje o navegador é quem "renderiza" o certificado (tela +
// impressão/Salvar como PDF do próprio navegador). buildValidationUrl()
// já devolve o link estável que um serviço de geração de PDF ou o QR Code
// usam; quando existir uma function de PDF, ela pode reaproveitar a mesma
// fn_validate_certificate() do banco para montar o documento.

export function buildValidationUrl(certificateNumber) {
  return new URL(`validate.html?certificate=${encodeURIComponent(certificateNumber)}`, window.location.href).href;
}

export async function generateQrDataUrl(text) {
  try {
    const { default: QRCode } = await import('https://esm.sh/qrcode@1.5.3');
    return await QRCode.toDataURL(text, { width: 160, margin: 1 });
  } catch {
    return null;
  }
}
