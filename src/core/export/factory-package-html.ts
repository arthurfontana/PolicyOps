import type { Block, InlineText, RichDoc } from '../document/schema';
import {
  FACTORY_PACKAGE_CHANGE_TYPE_LABELS,
  FACTORY_PACKAGE_COMPONENT_TYPE_LABELS,
  FACTORY_PACKAGE_PRIORITY_LABELS,
  FACTORY_PACKAGE_STATUS_LABELS,
  type FactoryPackage,
  type FactoryPackageAttachmentRef,
} from './factory-package';
import { dateStamp } from './filename';

/**
 * HTML de impressão do Pacote para a Fábrica — docs/14 §8. Documento
 * autocontido (sem CSS/JS externo, docs/02 §2): uma janela dedicada abre este
 * HTML e usa `window.print()` do navegador — o mesmo hábito corporativo de
 * "imprimir em PDF" que já existe para a matriz.
 */

// ---------------------------------------------------------------------------
// Utilitários de escape e formatação
// ---------------------------------------------------------------------------
// #region: utilitarios

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `AAAA-MM-DD…` → `DD/MM/AAAA` — formatação manual, sem `Intl` (regra 4: núcleo sem `window`). */
function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  if (year === undefined || month === undefined || day === undefined) return iso;
  return `${day}/${month}/${year}`;
}

function formatIsoDateTime(iso: string): string {
  const date = formatIsoDate(iso);
  const time = iso.slice(11, 16);
  return time.length === 5 ? `${date} ${time}` : date;
}

// ---------------------------------------------------------------------------
// `RichDoc` → HTML
// ---------------------------------------------------------------------------
// #region: richdoc-html

function inlineToHtml(inline: InlineText): string {
  return inline
    .map((run) => {
      let html = escapeHtml(run.text);
      const marks = run.marks ?? [];
      if (marks.includes('code')) html = `<code>${html}</code>`;
      if (marks.includes('italic')) html = `<em>${html}</em>`;
      if (marks.includes('bold')) html = `<strong>${html}</strong>`;
      if (marks.includes('link') && run.href !== undefined) {
        html = `<a href="${escapeHtml(run.href)}">${html}</a>`;
      }
      return html;
    })
    .join('');
}

function blockToHtml(block: Block, images: Map<string, FactoryPackageAttachmentRef>): string {
  switch (block.type) {
    case 'heading1':
      return `<h3 class="rd-h1">${inlineToHtml(block.text)}</h3>`;
    case 'heading2':
      return `<h4 class="rd-h2">${inlineToHtml(block.text)}</h4>`;
    case 'quote':
      return `<blockquote>${inlineToHtml(block.text)}</blockquote>`;
    case 'callout':
      return `<div class="rd-callout">${inlineToHtml(block.text)}</div>`;
    case 'paragraph':
      return `<p>${inlineToHtml(block.text)}</p>`;
    case 'bulletList':
      return `<ul>${block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</ul>`;
    case 'numberList':
      return `<ol>${block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</ol>`;
    case 'table':
      return (
        `<table class="rd-table"><thead><tr>` +
        block.header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('') +
        `</tr></thead><tbody>` +
        block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
          .join('') +
        `</tbody></table>`
      );
    case 'image': {
      const image = images.get(block.attachmentId);
      if (image === undefined) return `<p class="rd-missing">[imagem não encontrada no documento]</p>`;
      const alt = escapeHtml(block.caption ?? image.fileName);
      const caption = block.caption === undefined ? '' : `<figcaption>${escapeHtml(block.caption)}</figcaption>`;
      return `<figure class="rd-figure"><img src="data:${escapeHtml(image.mimeType)};base64,${image.data}" alt="${alt}" />${caption}</figure>`;
    }
  }
}

function richDocToHtml(doc: RichDoc, images: Map<string, FactoryPackageAttachmentRef>): string {
  if (doc.blocks.length === 0) return '<p class="rd-empty">—</p>';
  return doc.blocks.map((block) => blockToHtml(block, images)).join('\n');
}

// ---------------------------------------------------------------------------
// Seções do pacote
// ---------------------------------------------------------------------------
// #region: secoes

function section(title: string, body: string, first = false): string {
  return `<section class="fp-section${first ? '' : ' fp-break'}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function identificationSection(pkg: FactoryPackage): string {
  const { identification: id } = pkg;
  const rows: Array<[string, string]> = [
    ['DB', id.changeRequestCode],
    ['Título', id.title],
    ['Projeto', id.projectName],
    ['Status', FACTORY_PACKAGE_STATUS_LABELS[id.status]],
    ['Solicitado por', id.requestedBy],
  ];
  if (id.owner !== undefined) rows.push(['Dono', id.owner]);
  if (id.priority !== undefined) rows.push(['Prioridade', FACTORY_PACKAGE_PRIORITY_LABELS[id.priority]]);
  rows.push(['Gerado em', formatIsoDateTime(id.generatedAt)]);
  const body = `<table class="fp-kv">${rows
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join('')}</table>`;
  return section('Identificação', body, true);
}

function versionHistorySection(pkg: FactoryPackage): string {
  const rows = pkg.versionHistory
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(formatIsoDateTime(entry.at))}</td><td>${escapeHtml(entry.by)}</td><td>${escapeHtml(
          entry.action,
        )}</td><td>${entry.comment === undefined ? '' : escapeHtml(entry.comment)}</td></tr>`,
    )
    .join('');
  const body = `<table class="rd-table"><thead><tr><th>Data</th><th>Quem</th><th>Ação</th><th>Comentário</th></tr></thead><tbody>${rows}</tbody></table>`;
  return section('Registro de versão', body);
}

function contactsSection(pkg: FactoryPackage): string {
  if (pkg.contacts.length === 0) return '';
  const rows = pkg.contacts
    .map(
      (contact) =>
        `<tr><td>${escapeHtml(contact.name)}</td><td>${contact.role === undefined ? '' : escapeHtml(contact.role)}</td><td>${
          contact.email === undefined ? '' : escapeHtml(contact.email)
        }</td></tr>`,
    )
    .join('');
  const body = `<table class="rd-table"><thead><tr><th>Nome</th><th>Papel</th><th>E-mail</th></tr></thead><tbody>${rows}</tbody></table>`;
  return section('Contatos', body);
}

function boilerplateSection(pkg: FactoryPackage, images: Map<string, FactoryPackageAttachmentRef>): string {
  if (pkg.boilerplate === null) return '';
  return section('Boilerplate', richDocToHtml(pkg.boilerplate, images));
}

function contextSection(pkg: FactoryPackage, images: Map<string, FactoryPackageAttachmentRef>): string {
  const parts: string[] = [];
  if (pkg.motivators.length > 0) {
    parts.push(`<p><strong>Motivadores:</strong> ${pkg.motivators.map(escapeHtml).join(', ')}</p>`);
  }
  parts.push(
    pkg.motivationText === null
      ? '<p class="rd-empty">Sem motivação registrada.</p>'
      : richDocToHtml(pkg.motivationText, images),
  );
  if (pkg.spec !== null) {
    parts.push('<h3 class="rd-h1">Especificação</h3>');
    parts.push(richDocToHtml(pkg.spec, images));
  }
  return section('Contexto e objetivo', parts.join('\n'));
}

function scopeSection(pkg: FactoryPackage): string {
  const rows = pkg.items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.componentCode)}<br /><span class="fp-muted">${escapeHtml(
          item.componentName,
        )} · ${escapeHtml(FACTORY_PACKAGE_COMPONENT_TYPE_LABELS[item.componentType])}</span></td><td>${escapeHtml(
          FACTORY_PACKAGE_CHANGE_TYPE_LABELS[item.changeType],
        )}</td><td>${escapeHtml(item.current)}</td><td>${escapeHtml(item.proposed)}</td></tr>`,
    )
    .join('');
  const body =
    pkg.items.length === 0
      ? '<p class="rd-empty">Nenhum item.</p>'
      : `<table class="rd-table"><thead><tr><th>Componente</th><th>Tipo de alteração</th><th>Hoje</th><th>Proposto</th></tr></thead><tbody>${rows}</tbody></table>`;
  return section('Escopo', body);
}

function impactsSection(pkg: FactoryPackage): string {
  const body =
    pkg.impacts.length === 0
      ? '<p class="rd-empty">Nenhum impacto registrado.</p>'
      : `<ul>${pkg.impacts
          .map(
            (impact) =>
              `<li><strong>${escapeHtml(impact.category)}</strong>${
                impact.description === undefined ? '' : ` — ${escapeHtml(impact.description)}`
              }</li>`,
          )
          .join('')}</ul>`;
  return section('Impactos', body);
}

function acceptanceCriteriaSection(pkg: FactoryPackage): string {
  const body =
    pkg.acceptanceCriteria.length === 0
      ? '<p class="rd-empty">Nenhum critério registrado.</p>'
      : `<ol>${pkg.acceptanceCriteria
          .map(
            (criterion) =>
              `<li><strong>Dado</strong> ${escapeHtml(criterion.given)}${
                criterion.when === undefined ? '' : `, <strong>quando</strong> ${escapeHtml(criterion.when)}`
              }, <strong>então</strong> ${escapeHtml(criterion.then)}</li>`,
          )
          .join('')}</ol>`;
  return section('Critérios de aceite', body);
}

function testScenariosSection(pkg: FactoryPackage): string {
  const body =
    pkg.testScenarios.length === 0
      ? '<p class="rd-empty">Nenhum cenário registrado.</p>'
      : `<ul>${pkg.testScenarios
          .map((scenario) => `<li><strong>${escapeHtml(scenario.kind)}</strong> — ${escapeHtml(scenario.description)}</li>`)
          .join('')}</ul>`;
  return section('Testes', body);
}

function effectiveDateSection(pkg: FactoryPackage): string {
  const rows: Array<[string, string]> = [];
  rows.push(['Vigência proposta', pkg.effectiveDate === undefined ? '—' : formatIsoDate(pkg.effectiveDate)]);
  if (pkg.releaseCode !== undefined) {
    rows.push(['Release', pkg.releaseName === undefined ? pkg.releaseCode : `${pkg.releaseCode} — ${pkg.releaseName}`]);
  }
  const body = `<table class="fp-kv">${rows
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join('')}</table>`;
  return section('Vigência', body);
}

function attachmentsSection(pkg: FactoryPackage): string {
  if (pkg.attachments.length === 0) return '';
  const body = pkg.attachments
    .map((attachment) => {
      const alt = escapeHtml(attachment.fileName);
      return `<figure class="rd-figure"><img src="data:${escapeHtml(attachment.mimeType)};base64,${attachment.data}" alt="${alt}" /><figcaption>${alt}</figcaption></figure>`;
    })
    .join('');
  return section('Anexos', body);
}

// ---------------------------------------------------------------------------
// Documento completo
// ---------------------------------------------------------------------------
// #region: documento

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  font-family: Georgia, 'Times New Roman', serif;
  color: #1a1a1a;
  background: #ffffff;
  margin: 0;
  padding: 0 2rem;
  line-height: 1.5;
}
h1 { font-size: 1.6rem; margin: 2rem 0 0.25rem; }
h1.fp-subtitle { font-size: 1rem; font-weight: normal; color: #555; margin-top: 0; }
h2 { font-size: 1.25rem; border-bottom: 2px solid #1a1a1a; padding-bottom: 0.25rem; margin-top: 0; }
h3.rd-h1 { font-size: 1.1rem; margin-top: 1.25rem; }
h4.rd-h2 { font-size: 1rem; margin-top: 1rem; }
table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 0.92rem; }
table.rd-table th, table.rd-table td, table.fp-kv th, table.fp-kv td {
  border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top;
}
table.fp-kv th { width: 12rem; background: #f5f5f5; }
table.rd-table thead th { background: #f5f5f5; }
blockquote { border-left: 3px solid #999; margin: 0.75rem 0; padding: 0.25rem 1rem; color: #444; }
.rd-callout { background: #fff8e1; border: 1px solid #f0d98c; border-radius: 4px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
.rd-empty, .rd-missing { color: #888; font-style: italic; }
.rd-figure { margin: 0.75rem 0; text-align: center; }
.rd-figure img { max-width: 100%; max-height: 22rem; }
.rd-figure figcaption { font-size: 0.85rem; color: #555; margin-top: 0.25rem; }
.fp-muted { color: #666; font-size: 0.85rem; }
.fp-section { margin-bottom: 2rem; }
.fp-break { page-break-before: always; break-before: page; }
@media print {
  body { padding: 0 1cm; }
  @page { size: A4; margin: 1.5cm; }
}
`;

/** `{código do DB}_pacote_{aaaammdd}.html` — mesmo esquema `aaaammdd` dos demais exports. */
export function factoryPackageHtmlFileName(changeRequestCode: string, at: Date = new Date()): string {
  return `${sanitizeForFileName(changeRequestCode)}_pacote_${dateStamp(at)}.html`;
}

function sanitizeForFileName(code: string): string {
  return code.replace(/[^A-Za-z0-9_-]+/g, '_');
}

/** Monta o HTML de impressão completo — string autocontida, sem asset externo. */
export function renderFactoryPackageHtml(pkg: FactoryPackage): string {
  const images = new Map(pkg.attachments.map((attachment) => [attachment.attachmentId, attachment] as const));
  const sections = [
    identificationSection(pkg),
    versionHistorySection(pkg),
    contactsSection(pkg),
    boilerplateSection(pkg, images),
    contextSection(pkg, images),
    scopeSection(pkg),
    impactsSection(pkg),
    acceptanceCriteriaSection(pkg),
    testScenariosSection(pkg),
    effectiveDateSection(pkg),
    attachmentsSection(pkg),
  ]
    .filter((html) => html.length > 0)
    .join('\n');

  const title = `${pkg.identification.changeRequestCode} — ${pkg.identification.title}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escapeHtml(pkg.identification.changeRequestCode)} — ${escapeHtml(pkg.identification.title)}</h1>
<h1 class="fp-subtitle">${escapeHtml(pkg.identification.projectName)} · Pacote para a Fábrica</h1>
${sections}
</body>
</html>`;
}
