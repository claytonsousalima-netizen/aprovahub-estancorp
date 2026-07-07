import { ROLE_LABEL } from '../constants/roles.js';
import { buildValidationUrl, generateQrDataUrl } from './certificate.service.js';
import { getSignedFileUrl, recordFileAccessEvidence } from './document-detail.service.js';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = (v) => (v ? new Date(v).toLocaleString('pt-BR') : '—');
const STATUS_LABEL = { draft: 'Rascunho', pending: 'Pendente', approved: 'Aprovado', rejected: 'Reprovado', cancelled: 'Cancelado', expired: 'Expirado' };
const SIGNATURE_EVIDENCE_ACTIONS = new Set(['approve', 'reject', 'certificate_generated']);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function wrapText(text, font, size, maxWidth) {
  const out = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function createWriter(pdfDoc, fonts) {
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const label = { text: '' };

  function ensureSpace(h) {
    if (y - h < MARGIN + 20) {
      footer();
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  function footer() {
    page.drawText(label.text, { x: MARGIN, y: 24, size: 8, font: fonts.regular, color: fonts.muted });
  }

  return {
    setFooterLabel(text) {
      label.text = text;
    },
    heading(text, { size = 15 } = {}) {
      ensureSpace(size + 14);
      page.drawText(text, { x: MARGIN, y, size, font: fonts.bold, color: fonts.ink });
      y -= size + 4;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.2, color: fonts.brass });
      y -= 14;
    },
    subheading(text, { size = 11.5 } = {}) {
      ensureSpace(size + 10);
      page.drawText(text, { x: MARGIN, y, size, font: fonts.bold, color: fonts.petrol });
      y -= size + 8;
    },
    text(text, { size = 10, font = fonts.regular, color = fonts.ink, gap = 4 } = {}) {
      const lines = wrapText(text, font, size, CONTENT_W);
      for (const line of lines) {
        ensureSpace(size + 3);
        page.drawText(line, { x: MARGIN, y, size, font, color });
        y -= size + 3;
      }
      y -= gap;
    },
    keyValueRow(pairs, { size = 9.5 } = {}) {
      const colW = CONTENT_W / 2;
      ensureSpace(size * 2 + 14);
      pairs.forEach(([k, v], i) => {
        const x = MARGIN + (i % 2) * colW;
        if (i === 2) y -= size * 2 + 10;
        page.drawText(k.toUpperCase(), { x, y, size: 7.5, font: fonts.bold, color: fonts.muted });
        page.drawText(String(v ?? '—'), { x, y: y - 12, size, font: fonts.regular, color: fonts.ink });
      });
      y -= size * 2 + 16;
    },
    spacer(h = 10) {
      y -= h;
    },
    async image(bytes, kind, { maxW = CONTENT_W, maxH = 160, caption } = {}) {
      const img = kind === 'png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * ratio;
      const h = img.height * ratio;
      ensureSpace(h + (caption ? 14 : 0) + 10);
      page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 6;
      if (caption) {
        page.drawText(caption, { x: MARGIN, y, size: 8, font: fonts.regular, color: fonts.muted });
        y -= 14;
      }
    },
    newPage() {
      footer();
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    },
    finish() {
      footer();
    },
  };
}

async function buildAttachmentPlaceholderPage(pdfDoc, fonts, file, message) {
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  page.drawText(`Anexo: ${file.original_filename}`, { x: MARGIN, y: PAGE_H - MARGIN, size: 13, font: fonts.bold, color: fonts.ink });
  const lines = wrapText(message, fonts.regular, 10, CONTENT_W);
  let y = PAGE_H - MARGIN - 24;
  for (const line of lines) {
    page.drawText(line, { x: MARGIN, y, size: 10, font: fonts.regular, color: fonts.muted });
    y -= 14;
  }
}

/**
 * Monta um único PDF consolidando capa/certificado, resumo, lista de
 * arquivos, histórico/auditoria e comentários — e mescla, quando possível,
 * o conteúdo real dos anexos (PDF e imagens) como páginas adicionais.
 * Anexos em formatos que o navegador não sabe embutir num PDF (xls/doc)
 * viram uma página de aviso, não travam a exportação inteira.
 */
export async function buildProcessPdf(doc, auditLogs, { userId } = {}) {
  const { PDFDocument, StandardFonts, rgb } = await import('https://esm.sh/pdf-lib@1.17.1');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Processo de aprovação — ${doc.title}`);
  pdfDoc.setSubject(doc.certificate_number || doc.id);

  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    ink: rgb(0.078, 0.137, 0.180),
    petrol: rgb(0.055, 0.227, 0.290),
    brass: rgb(0.659, 0.510, 0.235),
    muted: rgb(0.42, 0.46, 0.49),
    danger: rgb(0.69, 0.27, 0.18),
  };

  const footerLabel = `AprovaHub Estancorp · ${doc.certificate_number || `processo ${doc.id.slice(0, 8)}`} · gerado em ${new Date().toLocaleString('pt-BR')}`;
  const w = createWriter(pdfDoc, fonts);
  w.setFooterLabel(footerLabel);

  // ---- Capa ----
  w.text('APROVAHUB ESTANCORP', { size: 10, font: fonts.bold, color: fonts.brass, gap: 2 });
  w.text('Processo completo de aprovação', { size: 10, color: fonts.muted, gap: 10 });
  w.heading(doc.title, { size: 19 });
  w.text(`Status: ${STATUS_LABEL[doc.status] || doc.status}${doc.certificate_number ? ` · Certificado ${doc.certificate_number}` : ''}`, { size: 11, font: fonts.bold });
  w.spacer(4);
  w.keyValueRow([
    ['Hotel', doc.hotels?.name],
    ['Tipo', doc.approval_types?.name],
    ['Valor', fmt(doc.amount)],
    ['Fornecedor', doc.supplier_name || '—'],
    ['Centro de custo', doc.cost_center || '—'],
    ['Solicitante', doc.creator?.full_name],
  ]);
  w.keyValueRow([
    ['Criado em', dt(doc.created_at)],
    ['Aprovação final', doc.final_decision_at ? dt(doc.final_decision_at) : '—'],
  ]);
  if (doc.final_hash) {
    w.text(`Hash final: ${doc.final_hash}`, { size: 8, font: fonts.regular, color: fonts.muted });
  }

  if (doc.status === 'approved' && doc.certificate_number) {
    w.spacer(6);
    const validationUrl = buildValidationUrl(doc.certificate_number);
    try {
      const qrDataUrl = await generateQrDataUrl(validationUrl);
      if (qrDataUrl) await w.image(dataUrlToBytes(qrDataUrl), 'png', { maxW: 110, maxH: 110, caption: `Validar: ${validationUrl}` });
    } catch {
      w.text(`Validar este certificado: ${validationUrl}`, { size: 8.5, color: fonts.muted });
    }
  }

  // ---- Resumo ----
  w.newPage();
  w.heading('Resumo');
  if (doc.description) {
    w.subheading('Descrição/justificativa');
    w.text(doc.description);
  }
  w.subheading('Linha do tempo das aprovações');
  const steps = [...(doc.document_approval_steps || [])].sort((a, b) => a.step_order - b.step_order);
  if (!steps.length) {
    w.text('Este documento ainda não tem etapas de aprovação (rascunho).', { color: fonts.muted });
  }
  for (const s of steps) {
    const roleLabel = ROLE_LABEL[s.role_required] || s.role_required;
    if (s.status === 'approved') {
      w.text(`${s.step_order}. ${roleLabel} — Aprovado por ${s.approver?.full_name || '—'} em ${dt(s.approved_at)}`, { font: fonts.bold, gap: 1 });
    } else if (s.status === 'rejected') {
      w.text(`${s.step_order}. ${roleLabel} — Reprovado por ${s.rejecter?.full_name || '—'} em ${dt(s.rejected_at)}`, { font: fonts.bold, color: fonts.danger, gap: 1 });
      w.text(`Motivo: ${s.rejection_reason || 'sem motivo informado'}`, { size: 9, color: fonts.muted });
    } else if (s.step_order === doc.current_step_order && doc.status === 'pending') {
      w.text(`${s.step_order}. ${roleLabel} — Aguardando decisão (${s.assignee?.full_name || 'qualquer aprovador elegível'})`, { font: fonts.bold, color: fonts.brass, gap: 1 });
    } else {
      w.text(`${s.step_order}. ${roleLabel} — ainda não chegou a vez`, { size: 9.5, color: fonts.muted, gap: 1 });
    }
  }

  // ---- Arquivos (lista) ----
  const files = [...(doc.document_files || [])].sort((a, b) => a.file_order - b.file_order);
  w.newPage();
  w.heading('Arquivos anexados');
  if (!files.length) {
    w.text('Nenhum arquivo anexado.', { color: fonts.muted });
  } else {
    w.text('Os arquivos listados abaixo estão mesclados neste PDF nas páginas seguintes, quando o formato permite; quando não, há uma página de aviso no lugar.', { size: 9, color: fonts.muted });
    for (const f of files) {
      w.text(`${f.file_order}. ${f.original_filename} — ${((f.size_bytes || 0) / 1024).toFixed(0)} KB`, { gap: 2 });
    }
  }

  // ---- Histórico/Auditoria ----
  w.newPage();
  w.heading('Histórico/Auditoria');
  const events = [{ t: doc.created_at, label: `Documento criado por ${doc.creator?.full_name || ''}` }];
  for (const s of steps) {
    if (s.approved_at) events.push({ t: s.approved_at, label: `${ROLE_LABEL[s.role_required] || s.role_required} aprovado por ${s.approver?.full_name || ''}` });
    if (s.rejected_at) events.push({ t: s.rejected_at, label: `${ROLE_LABEL[s.role_required] || s.role_required} reprovado por ${s.rejecter?.full_name || ''}: ${s.rejection_reason || ''}` });
  }
  events.sort((a, b) => new Date(b.t) - new Date(a.t));
  for (const e of events) {
    w.text(`${dt(e.t)} — ${e.label}`, { size: 9.5, gap: 2 });
  }

  const evid = [...(doc.approval_evidences || [])].filter((e) => SIGNATURE_EVIDENCE_ACTIONS.has(e.action)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (evid.length) {
    w.spacer(4);
    w.subheading('Evidências de assinatura');
    for (const e of evid) {
      const auth = e.mfa_verified ? 'MFA verificado' : e.password_reconfirmed ? 'Senha reconfirmada' : 'sem reautenticação';
      w.text(`${e.action.toUpperCase()} por ${e.profiles?.full_name || ''}${e.user_email ? ` (${e.user_email})` : ''} · ${dt(e.created_at)} · ${auth}`, { size: 9.5, gap: 1 });
      if (e.rejection_reason) w.text(`Motivo: ${e.rejection_reason}`, { size: 9, color: fonts.muted, gap: 1 });
      w.text(e.evidence_hash || '', { size: 7.5, font: fonts.regular, color: fonts.muted, gap: 4 });
    }
  }

  if (auditLogs && auditLogs.length) {
    w.spacer(4);
    w.subheading('Log de auditoria (administrativo)');
    for (const l of auditLogs) {
      w.text(`${dt(l.created_at)} — ${l.action} · ${l.profiles?.full_name || 'sistema'}`, { size: 9, gap: 1 });
    }
  }

  // ---- Comentários ----
  w.newPage();
  w.heading('Comentários');
  const comments = [...(doc.document_comments || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (!comments.length) {
    w.text('Nenhum comentário registrado.', { color: fonts.muted });
  } else {
    for (const c of comments) {
      w.text(`${c.profiles?.full_name || ''}${c.internal_only ? ' (interno)' : ''} — ${dt(c.created_at)}`, { size: 9, font: fonts.bold, gap: 2 });
      w.text(c.comment, { size: 9.5, gap: 6 });
    }
  }

  w.finish();

  // ---- Mescla o conteúdo real dos anexos ----
  for (const f of files) {
    try {
      const url = await getSignedFileUrl(f, 120);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());

      if (f.mime_type === 'application/pdf') {
        const labelPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        labelPage.drawText(`Anexo ${f.file_order}: ${f.original_filename}`, { x: MARGIN, y: PAGE_H - MARGIN, size: 13, font: fonts.bold, color: fonts.ink });
        const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copied = await pdfDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        copied.forEach((p) => pdfDoc.addPage(p));
      } else if (f.mime_type === 'image/png' || f.mime_type === 'image/jpeg') {
        const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        page.drawText(`Anexo ${f.file_order}: ${f.original_filename}`, { x: MARGIN, y: PAGE_H - MARGIN, size: 13, font: fonts.bold, color: fonts.ink });
        const img = f.mime_type === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        const maxW = CONTENT_W;
        const maxH = PAGE_H - MARGIN * 2 - 40;
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        page.drawImage(img, { x: MARGIN, y: PAGE_H - MARGIN - 30 - img.height * ratio, width: img.width * ratio, height: img.height * ratio });
      } else {
        await buildAttachmentPlaceholderPage(
          pdfDoc,
          fonts,
          f,
          'Pré-visualização/mesclagem não disponível para este tipo de arquivo neste PDF consolidado. Baixe este anexo separadamente pela aba Arquivos do documento no sistema.'
        );
      }

      if (userId) {
        try {
          await recordFileAccessEvidence({ documentId: doc.id, userId, action: 'download' });
        } catch {
          // não bloqueia a exportação por causa do registro de evidência
        }
      }
    } catch (err) {
      await buildAttachmentPlaceholderPage(pdfDoc, fonts, f, `Não foi possível incluir este anexo no PDF consolidado (${err.message}). Baixe-o separadamente pela aba Arquivos do documento no sistema.`);
    }
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export function processPdfFileName(doc) {
  const safeTitle = (doc.title || 'documento').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return `processo-${doc.certificate_number || safeTitle}.pdf`;
}
