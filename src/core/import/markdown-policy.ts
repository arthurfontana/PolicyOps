import type { ComponentOrigin, ComponentPayload, PolicyComponentType } from '../document/schema';
import { PAYLOAD_KIND_BY_COMPONENT_TYPE } from '../document/schema';
import { normalizeText } from '../library/text-normalize';
import { importIssue, type ImportIssue } from './issues';
import { normalizeValue } from './profile';

/**
 * Parser da carga por recorte — docs/14-governanca-de-alteracoes.md §9/§9.1
 * (formato normativo), docs/prompts/S40-carga-de-componentes.md.
 *
 * Puro e sem dependência de lib de Markdown: o subset aceito é pequeno de
 * propósito — headings (`#`..`######`), parágrafos, blockquotes de marcador
 * (`> Rótulo: valor`) e listas (`-`/`*`/`1.`). **Nunca lança**: qualquer coisa
 * que o texto colado trouxer fora do esperado vira `ImportIssue` de aviso,
 * dobrado no que já foi reconhecido, nunca uma exceção — o Markdown chega de
 * fora da ferramenta (DEC-GOV-007) e pode estar torto.
 *
 * Um heading vira um nó da árvore; o nível relativo entre headings (não o
 * número de `#`) é o que decide pai/filho, então um recorte que começa em
 * `###` continua reconhecível — quem decide onde ele entra na árvore do
 * projeto é o passo de destino do assistente (`markdown-plan.ts`), não este
 * parser.
 */

/** `MATRIX` fica de fora: docs/14 §9 é explícito — matriz não nasce de Markdown, ela já existe. */
export const MARKDOWN_COMPONENT_TYPES: readonly PolicyComponentType[] = [
  'SECTION',
  'RULE',
  'LIST',
  'REASON_CODE',
  'POLICY_VARIABLE',
  'OTHER',
];

export type MarkdownTypeSource = 'EXPLICIT' | 'HEURISTIC';

/** Um nó proposto pelo parser — ainda não é `PolicyComponent`: sem `id`, `projectId` nem `parentId`. */
export type MarkdownComponentNode = {
  /** Estável dentro deste parse; usado pelo plano para reparentar sem depender de índice de array. */
  tempId: string;
  /** Nível bruto do heading (1 = `#`) — só para exibição; a hierarquia real é `children`. */
  level: number;
  name: string;
  type: PolicyComponentType;
  typeSource: MarkdownTypeSource;
  code: string;
  /** Texto de negócio já montado (parágrafos + itens de lista) — a base de todo `payload` por tipo. */
  businessDescription: string;
  /** Marcadores capturados, crus — o plano reconstrói o payload quando o tipo é trocado na revisão. */
  markers: CapturedMarkers;
  payload: ComponentPayload;
  origin?: ComponentOrigin;
  /** Avisos deste nó — heurística de tipo, marcador não reconhecido, marcador com valor inválido. */
  issues: ImportIssue[];
  children: MarkdownComponentNode[];
};

export type MarkdownParseResult = {
  /** Nós de nível mais alto do recorte — não necessariamente heading nível 1. */
  roots: MarkdownComponentNode[];
  /** Problemas de nível de documento (nenhum heading encontrado, texto antes do primeiro heading). */
  issues: ImportIssue[];
};

// ---------------------------------------------------------------------------
// Marcadores
// ---------------------------------------------------------------------------
// #region: marcadores

type MarkerKey =
  | 'tipo'
  | 'codigo'
  | 'definicaoTecnica'
  | 'entradas'
  | 'condicoes'
  | 'resultado'
  | 'reasonCode'
  | 'dependencias'
  | 'fonte'
  | 'notas';

export type CapturedMarkers = Partial<Record<MarkerKey, string>>;

/** Alias normalizado (sem acento, maiúsculo) → chave interna. docs/14 §9.1, lista de marcadores. */
const MARKER_ALIASES: ReadonlyArray<{ alias: string; key: MarkerKey }> = [
  { alias: 'TIPO', key: 'tipo' },
  { alias: 'CODIGO', key: 'codigo' },
  { alias: 'DEFINICAO TECNICA', key: 'definicaoTecnica' },
  { alias: 'ENTRADAS', key: 'entradas' },
  { alias: 'CONDICOES', key: 'condicoes' },
  { alias: 'RESULTADO', key: 'resultado' },
  { alias: 'REASON CODE', key: 'reasonCode' },
  { alias: 'REASON CODES', key: 'reasonCode' },
  { alias: 'DEPENDENCIAS', key: 'dependencias' },
  { alias: 'FONTE', key: 'fonte' },
  { alias: 'NOTAS', key: 'notas' },
];

function matchMarker(content: string): { key: MarkerKey; value: string } | null {
  const colon = content.indexOf(':');
  if (colon < 0) return null;
  const label = normalizeText(content.slice(0, colon).trim());
  const found = MARKER_ALIASES.find((entry) => entry.alias === label);
  if (found === undefined) return null;
  return { key: found.key, value: content.slice(colon + 1).trim() };
}

/** Lista separada por vírgula ou " e " → itens não vazios, aparados. */
function splitList(value: string): string[] {
  return value
    .split(/,| e /i)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** `"Filtros e Critérios B2C, p. 10"` → `{ source, locator }` (docs/14 §3.1). */
function parseOrigin(value: string): ComponentOrigin {
  const comma = value.indexOf(',');
  if (comma < 0) return { source: value.trim() };
  const source = value.slice(0, comma).trim();
  const locator = value.slice(comma + 1).trim();
  return locator.length > 0 ? { source, locator } : { source };
}

/** `> Tipo: reason_code` → `REASON_CODE`; valor não reconhecido devolve `undefined`. */
function matchType(value: string): PolicyComponentType | undefined {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  return MARKDOWN_COMPONENT_TYPES.find((candidate) => candidate === normalized);
}

// ---------------------------------------------------------------------------
// Derivação de código
// ---------------------------------------------------------------------------
// #region: derivacao-de-codigo

const FALLBACK_CODE = 'COMPONENTE';

/** Nome/valor de `> Código:` → `code` válido (`^[A-Z0-9_]+$`), único no parse. */
function uniqueCode(base: string, used: Set<string>): string {
  const normalized = normalizeValue(base) || FALLBACK_CODE;
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }
  let suffix = 2;
  let candidate = `${normalized}_${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${normalized}_${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Construção de nó
// ---------------------------------------------------------------------------
// #region: construcao-de-no

function resolveType(
  markers: CapturedMarkers,
  name: string,
  lineNo: number,
): { type: PolicyComponentType; typeSource: MarkdownTypeSource; issue?: ImportIssue } {
  if (markers.tipo === undefined) {
    return {
      type: 'RULE',
      typeSource: 'HEURISTIC',
      issue: importIssue(
        'MARKDOWN_TYPE_HEURISTIC',
        `"${name}" não trouxe "> Tipo:" — assumido RULE por heurística; confira antes de confirmar.`,
        { line: lineNo },
      ),
    };
  }
  const matched = matchType(markers.tipo);
  if (matched === undefined) {
    return {
      type: 'RULE',
      typeSource: 'HEURISTIC',
      issue: importIssue(
        'MARKDOWN_MARKER_IGNORED',
        `"${name}": "> Tipo: ${markers.tipo}" não é um tipo reconhecido — assumido RULE por heurística.`,
        { line: lineNo },
      ),
    };
  }
  return { type: matched, typeSource: 'EXPLICIT' };
}

/**
 * Payload por tipo a partir do texto de negócio e dos marcadores crus —
 * exportada para o plano (`markdown-plan.ts`) reconstruir o payload quando o
 * tipo de uma linha é trocado na revisão, sem duplicar a regra de dobra em
 * `notes`.
 */
export function buildPayload(
  type: PolicyComponentType,
  businessDescription: string,
  markers: CapturedMarkers,
): ComponentPayload {
  if (type === 'RULE') {
    const payload: ComponentPayload = { kind: 'RULE', businessDescription };
    if (markers.definicaoTecnica !== undefined && markers.definicaoTecnica.length > 0) {
      payload.technicalDefinition = markers.definicaoTecnica;
    }
    if (markers.entradas !== undefined) {
      const inputs = splitList(markers.entradas);
      if (inputs.length > 0) payload.inputs = inputs;
    }
    if (markers.condicoes !== undefined && markers.condicoes.length > 0) {
      payload.conditions = markers.condicoes;
    }
    if (markers.resultado !== undefined && markers.resultado.length > 0) {
      payload.outcome = markers.resultado;
    }
    if (markers.reasonCode !== undefined) {
      const reasonCodes = splitList(markers.reasonCode);
      if (reasonCodes.length > 0) payload.reasonCodes = reasonCodes;
    }
    if (markers.dependencias !== undefined) {
      const dependencies = splitList(markers.dependencias);
      if (dependencies.length > 0) payload.dependencies = dependencies;
    }
    if (markers.notas !== undefined && markers.notas.length > 0) payload.notes = markers.notas;
    return payload;
  }

  // Fora de RULE, o payload só tem `businessDescription`/`notes` (docs/03
  // §12): os demais marcadores capturados não têm campo — em vez de
  // descartá-los, dobram em `notes` rotulados, para a carga nunca perder o
  // que o Markdown trouxe.
  const extras: string[] = [];
  if (markers.definicaoTecnica !== undefined) extras.push(`Definição técnica: ${markers.definicaoTecnica}`);
  if (markers.entradas !== undefined) extras.push(`Entradas: ${markers.entradas}`);
  if (markers.condicoes !== undefined) extras.push(`Condições: ${markers.condicoes}`);
  if (markers.resultado !== undefined) extras.push(`Resultado: ${markers.resultado}`);
  if (markers.reasonCode !== undefined) extras.push(`Reason code: ${markers.reasonCode}`);
  if (markers.dependencias !== undefined) extras.push(`Dependências: ${markers.dependencias}`);
  const joined = [markers.notas, ...extras].filter((part) => part !== undefined && part.length > 0).join(' | ');
  const notes = joined.length > 0 ? joined : undefined;

  // LIST/REASON_CODE/POLICY_VARIABLE/OTHER têm a mesma forma mínima
  // (`kind`, `businessDescription`, `notes?`) — os campos extras de cada um
  // (`purpose`, `code`/`decision`, `technicalName`...) não têm marcador
  // dedicado no Markdown (docs/14 §9.1), então ficam de fora por enquanto.
  const kind = PAYLOAD_KIND_BY_COMPONENT_TYPE[type as Exclude<PolicyComponentType, 'MATRIX'>];
  return notes === undefined
    ? ({ kind, businessDescription } as ComponentPayload)
    : ({ kind, businessDescription, notes } as ComponentPayload);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
// #region: parser

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const LIST_ITEM_RE = /^(?:[-*+]\s+|\d+[.)]\s+)(.*)$/;

type OpenNode = {
  node: MarkdownComponentNode;
  markers: CapturedMarkers;
  blocks: string[];
  blockLines: string[];
  lineNo: number;
};

export function parseMarkdownPolicy(text: string): MarkdownParseResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const roots: MarkdownComponentNode[] = [];
  const docIssues: ImportIssue[] = [];
  const usedCodes = new Set<string>();
  const stack: Array<{ level: number; node: MarkdownComponentNode }> = [];

  let seq = 0;
  let open: OpenNode | null = null;
  let sawContentBeforeFirstHeading = false;

  function flushBlock(target: OpenNode): void {
    if (target.blockLines.length > 0) {
      target.blocks.push(target.blockLines.join(' '));
      target.blockLines = [];
    }
  }

  function finalize(target: OpenNode): void {
    flushBlock(target);
    const businessDescription = target.blocks.join('\n\n') || target.node.name;
    const { type, typeSource, issue } = resolveType(target.markers, target.node.name, target.lineNo);
    target.node.type = type;
    target.node.typeSource = typeSource;
    if (issue !== undefined) target.node.issues.push(issue);

    const explicitCode = target.markers.codigo;
    target.node.code = uniqueCode(explicitCode !== undefined && explicitCode.length > 0 ? explicitCode : target.node.name, usedCodes);
    target.node.businessDescription = businessDescription;
    target.node.markers = target.markers;
    target.node.payload = buildPayload(type, businessDescription, target.markers);
    if (target.markers.fonte !== undefined && target.markers.fonte.length > 0) {
      target.node.origin = parseOrigin(target.markers.fonte);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;

    const heading = HEADING_RE.exec(raw);
    if (heading !== null) {
      if (open !== null) finalize(open);
      const level = heading[1]!.length;
      const name = heading[2]!.trim();
      if (name.length === 0) {
        docIssues.push(
          importIssue('MARKDOWN_MARKER_IGNORED', `Heading vazio na linha ${lineNo} — ignorado.`, { line: lineNo }),
        );
        open = null;
        continue;
      }
      const node: MarkdownComponentNode = {
        tempId: `n${seq++}`,
        level,
        name,
        type: 'RULE',
        typeSource: 'HEURISTIC',
        code: '',
        businessDescription: name,
        markers: {},
        payload: { kind: 'OTHER', businessDescription: name },
        issues: [],
        children: [],
      };
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1]!.node.children.push(node);
      stack.push({ level, node });
      open = { node, markers: {}, blocks: [], blockLines: [], lineNo };
      continue;
    }

    if (open === null) {
      const trimmed = raw.trim();
      if (trimmed.length > 0) sawContentBeforeFirstHeading = true;
      continue;
    }

    const blockquote = BLOCKQUOTE_RE.exec(raw);
    if (blockquote !== null) {
      flushBlock(open);
      const content = blockquote[1]!.trim();
      if (content.length === 0) continue;
      const marker = matchMarker(content);
      if (marker !== null) {
        open.markers[marker.key] = marker.value;
      } else {
        // Blockquote sem marcador reconhecido: dobra em `notas` em vez de
        // sumir — o parser nunca descarta conteúdo em silêncio — com aviso.
        open.markers.notas = open.markers.notas === undefined ? content : `${open.markers.notas} | ${content}`;
        open.node.issues.push(
          importIssue(
            'MARKDOWN_MARKER_IGNORED',
            `"${open.node.name}": bloco de citação na linha ${lineNo} não é um marcador reconhecido — guardado em notas.`,
            { line: lineNo },
          ),
        );
      }
      continue;
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      flushBlock(open);
      continue;
    }

    const listItem = LIST_ITEM_RE.exec(trimmed);
    if (listItem !== null) {
      flushBlock(open);
      open.blocks.push(listItem[1]!.trim());
      continue;
    }

    open.blockLines.push(trimmed);
  }

  if (open !== null) finalize(open);

  if (roots.length === 0) {
    docIssues.push(
      importIssue(
        'MARKDOWN_NO_HEADINGS',
        'Nenhum heading encontrado no texto colado — comece o recorte em "#", "##" etc.',
      ),
    );
  } else if (sawContentBeforeFirstHeading) {
    docIssues.push(
      importIssue(
        'MARKDOWN_MARKER_IGNORED',
        'Havia texto antes do primeiro heading — ele foi ignorado, nenhum componente nasce sem um título.',
      ),
    );
  }

  return { roots, issues: docIssues };
}
