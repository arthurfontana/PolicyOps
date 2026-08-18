import type { Block, InlineText, RichDoc } from '../document/schema';
import {
  FACTORY_PACKAGE_CHANGE_TYPE_LABELS,
  FACTORY_PACKAGE_COMPONENT_TYPE_LABELS,
  FACTORY_PACKAGE_PRIORITY_LABELS,
  FACTORY_PACKAGE_STATUS_LABELS,
  type FactoryPackage,
} from './factory-package';
import { dateStamp } from './filename';

/**
 * Markdown do Pacote para a Fábrica — docs/14 §8. Imagens embutidas do
 * `RichDoc` **não** viram base64 aqui (isso é o HTML): cada bloco `image` vira
 * uma referência pelo nome do anexo, com um aviso único no topo do documento
 * — exatamente o que o escopo da S38 pede ("imagens referenciadas por nome de
 * anexo + aviso").
 */

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
// #region: utilitarios

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

/** Escape mínimo de célula de tabela Markdown — só o que quebraria a sintaxe. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(header: string[], rows: string[][]): string {
  const head = `| ${header.join(' | ')} |`;
  const sep = `| ${header.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`).join('\n');
  return rows.length === 0 ? `${head}\n${sep}` : `${head}\n${sep}\n${body}`;
}

// ---------------------------------------------------------------------------
// `RichDoc` → Markdown
// ---------------------------------------------------------------------------
// #region: richdoc-markdown

function inlineToMarkdown(inline: InlineText): string {
  return inline
    .map((run) => {
      let text = run.text;
      const marks = run.marks ?? [];
      if (marks.includes('code')) text = `\`${text}\``;
      if (marks.includes('italic')) text = `_${text}_`;
      if (marks.includes('bold')) text = `**${text}**`;
      if (marks.includes('link') && run.href !== undefined) text = `[${text}](${run.href})`;
      return text;
    })
    .join('');
}

function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case 'heading1':
      return `### ${inlineToMarkdown(block.text)}`;
    case 'heading2':
      return `#### ${inlineToMarkdown(block.text)}`;
    case 'quote':
      return `> ${inlineToMarkdown(block.text)}`;
    case 'callout':
      return `> **Nota:** ${inlineToMarkdown(block.text)}`;
    case 'paragraph':
      return inlineToMarkdown(block.text);
    case 'bulletList':
      return block.items.map((item) => `- ${inlineToMarkdown(item)}`).join('\n');
    case 'numberList':
      return block.items.map((item, index) => `${index + 1}. ${inlineToMarkdown(item)}`).join('\n');
    case 'table':
      return table(block.header, block.rows);
    case 'image': {
      const label = block.caption === undefined ? '' : ` — ${block.caption}`;
      return `*[Imagem anexada${label}; ver "Anexos" ou a versão em HTML/impressão para visualizá-la.]*`;
    }
  }
}

function richDocToMarkdown(doc: RichDoc): string {
  if (doc.blocks.length === 0) return '_—_';
  return doc.blocks.map(blockToMarkdown).join('\n\n');
}

// ---------------------------------------------------------------------------
// Seções do pacote
// ---------------------------------------------------------------------------
// #region: secoes

function heading(title: string): string {
  return `## ${title}`;
}

function identificationSection(pkg: FactoryPackage): string {
  const { identification: id } = pkg;
  const rows: string[][] = [
    ['DB', id.changeRequestCode],
    ['Título', id.title],
    ['Projeto', id.projectName],
    ['Status', FACTORY_PACKAGE_STATUS_LABELS[id.status]],
    ['Solicitado por', id.requestedBy],
  ];
  if (id.owner !== undefined) rows.push(['Dono', id.owner]);
  if (id.priority !== undefined) rows.push(['Prioridade', FACTORY_PACKAGE_PRIORITY_LABELS[id.priority]]);
  rows.push(['Gerado em', formatIsoDateTime(id.generatedAt)]);
  return `${heading('Identificação')}\n\n${table(['Campo', 'Valor'], rows)}`;
}

function versionHistorySection(pkg: FactoryPackage): string {
  const rows = pkg.versionHistory.map((entry) => [
    formatIsoDateTime(entry.at),
    entry.by,
    entry.action,
    entry.comment ?? '',
  ]);
  return `${heading('Registro de versão')}\n\n${table(['Data', 'Quem', 'Ação', 'Comentário'], rows)}`;
}

function contactsSection(pkg: FactoryPackage): string | null {
  if (pkg.contacts.length === 0) return null;
  const rows = pkg.contacts.map((contact) => [contact.name, contact.role ?? '', contact.email ?? '']);
  return `${heading('Contatos')}\n\n${table(['Nome', 'Papel', 'E-mail'], rows)}`;
}

function boilerplateSection(pkg: FactoryPackage): string | null {
  if (pkg.boilerplate === null) return null;
  return `${heading('Boilerplate')}\n\n${richDocToMarkdown(pkg.boilerplate)}`;
}

function contextSection(pkg: FactoryPackage): string {
  const parts: string[] = [];
  if (pkg.motivators.length > 0) parts.push(`**Motivadores:** ${pkg.motivators.join(', ')}`);
  parts.push(pkg.motivationText === null ? '_Sem motivação registrada._' : richDocToMarkdown(pkg.motivationText));
  if (pkg.spec !== null) {
    parts.push('### Especificação');
    parts.push(richDocToMarkdown(pkg.spec));
  }
  return `${heading('Contexto e objetivo')}\n\n${parts.join('\n\n')}`;
}

function scopeSection(pkg: FactoryPackage): string {
  if (pkg.items.length === 0) return `${heading('Escopo')}\n\n_Nenhum item._`;
  const rows = pkg.items.map((item) => [
    `${item.componentCode} (${FACTORY_PACKAGE_COMPONENT_TYPE_LABELS[item.componentType]})`,
    FACTORY_PACKAGE_CHANGE_TYPE_LABELS[item.changeType],
    item.current,
    item.proposed,
  ]);
  return `${heading('Escopo')}\n\n${table(['Componente', 'Tipo de alteração', 'Hoje', 'Proposto'], rows)}`;
}

function impactsSection(pkg: FactoryPackage): string {
  if (pkg.impacts.length === 0) return `${heading('Impactos')}\n\n_Nenhum impacto registrado._`;
  const lines = pkg.impacts.map(
    (impact) => `- **${impact.category}**${impact.description === undefined ? '' : ` — ${impact.description}`}`,
  );
  return `${heading('Impactos')}\n\n${lines.join('\n')}`;
}

function acceptanceCriteriaSection(pkg: FactoryPackage): string {
  if (pkg.acceptanceCriteria.length === 0) {
    return `${heading('Critérios de aceite')}\n\n_Nenhum critério registrado._`;
  }
  const lines = pkg.acceptanceCriteria.map(
    (criterion, index) =>
      `${index + 1}. **Dado** ${criterion.given}${
        criterion.when === undefined ? '' : `, **quando** ${criterion.when}`
      }, **então** ${criterion.then}`,
  );
  return `${heading('Critérios de aceite')}\n\n${lines.join('\n')}`;
}

function testScenariosSection(pkg: FactoryPackage): string {
  if (pkg.testScenarios.length === 0) return `${heading('Testes')}\n\n_Nenhum cenário registrado._`;
  const lines = pkg.testScenarios.map((scenario) => `- **${scenario.kind}** — ${scenario.description}`);
  return `${heading('Testes')}\n\n${lines.join('\n')}`;
}

function effectiveDateSection(pkg: FactoryPackage): string {
  const rows: string[][] = [['Vigência proposta', pkg.effectiveDate === undefined ? '—' : formatIsoDate(pkg.effectiveDate)]];
  if (pkg.releaseCode !== undefined) {
    rows.push(['Release', pkg.releaseName === undefined ? pkg.releaseCode : `${pkg.releaseCode} — ${pkg.releaseName}`]);
  }
  return `${heading('Vigência')}\n\n${table(['Campo', 'Valor'], rows)}`;
}

function attachmentsSection(pkg: FactoryPackage): string | null {
  if (pkg.attachments.length === 0) return null;
  const lines = pkg.attachments.map((attachment) => `- ${attachment.fileName}`);
  return `${heading('Anexos')}\n\n${lines.join(
    '\n',
  )}\n\n_As imagens não estão embutidas neste Markdown — abra o pacote em HTML (impressão) para visualizá-las._`;
}

// ---------------------------------------------------------------------------
// Documento completo
// ---------------------------------------------------------------------------
// #region: documento

/** `{código do DB}_pacote_{aaaammdd}.md` — mesmo esquema `aaaammdd` dos demais exports. */
export function factoryPackageMarkdownFileName(changeRequestCode: string, at: Date = new Date()): string {
  return `${changeRequestCode.replace(/[^A-Za-z0-9_-]+/g, '_')}_pacote_${dateStamp(at)}.md`;
}

/** Monta o Markdown completo — string autocontida, sem imagem embutida (ver aviso em `attachmentsSection`). */
export function renderFactoryPackageMarkdown(pkg: FactoryPackage): string {
  const sections = [
    versionHistorySection(pkg),
    contactsSection(pkg),
    boilerplateSection(pkg),
    contextSection(pkg),
    scopeSection(pkg),
    impactsSection(pkg),
    acceptanceCriteriaSection(pkg),
    testScenariosSection(pkg),
    effectiveDateSection(pkg),
    attachmentsSection(pkg),
  ].filter((text): text is string => text !== null);

  const warning =
    pkg.attachments.length === 0
      ? ''
      : '\n> **Aviso:** este Markdown referencia imagens pelo nome do anexo; os arquivos não estão embutidos aqui. Abra o pacote em HTML (impressão) para visualizá-las.\n';

  return `# ${pkg.identification.changeRequestCode} — ${pkg.identification.title}\n\n${pkg.identification.projectName} · Pacote para a Fábrica\n${warning}\n${identificationSection(
    pkg,
  )}\n\n${sections.join('\n\n')}\n`;
}
