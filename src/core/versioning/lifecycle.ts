import { allCombinations, listPending, type CellCoord } from '../axes/combinations';
import { snapshotDomains } from '../axes/domain-snapshot';
import { decodeCellKey } from '../axes/paths';
import {
  assertGridFits,
  assertLevelsValid,
  assertVariablesNotOnBothAxes,
  collectPublishedCompatibility,
  generateTuples,
  type TupleLevelInput,
} from '../axes/tuples';
import {
  applyToDocument,
  defineCommand,
  irreversible,
  isoFrom,
  makeEvent,
  type Command,
  type Ctx,
} from '../command';
import { diffVersionPair } from '../diff/versions';
import { CODE_REGEX, ISO_DATE_REGEX } from '../document/schema';
import type {
  Axis,
  AxisLevel,
  AxisRole,
  CatalogItemKind,
  Cell,
  DocEvent,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
} from '../document/schema';
import { DomainError } from '../errors';
import { buildSeedCells, type SkippedSeedRule } from '../templates/seed';

/**
 * Ciclo de vida da versão de matriz — docs/05-regras-de-negocio.md §1.
 *
 * ```
 *      criar matriz                        publicar
 *       v1 DRAFT ────────────────────────► v1 PUBLISHED
 *                        criar rascunho ◄──────┤
 *                             v2 DRAFT         │
 *                        publicar ─► v2 PUBLISHED, v1 SUPERSEDED
 * ```
 *
 * `ARCHIVED` é terminal e só se alcança de `DRAFT` (rascunho descartado).
 */

// ---------------------------------------------------------------------------
// §1.5 Imutabilidade — a guarda mais importante do sistema
// ---------------------------------------------------------------------------

/**
 * Lança `VERSION_IMMUTABLE` se a versão não estiver em `DRAFT`. **Todo**
 * comando que toca `axes` ou `cells` chama isso antes de qualquer coisa
 * (docs/05 §1.5) — é o que sustenta I3.
 */
export function assertEditable(version: MatrixVersion): void {
  if (version.state !== 'DRAFT') {
    throw new DomainError(
      'VERSION_IMMUTABLE',
      `A versão ${version.number} está em ${version.state} e não pode mais ser editada.`,
      { versionId: version.id, state: version.state },
    );
  }
}

/**
 * Mesma condição de `assertEditable`, outro código de erro. Publicar e
 * descartar não tocam `axes` nem `cells`: mudam o estado da própria versão, e
 * docs/05 §1.3 nomeia explicitamente `VERSION_NOT_DRAFT` para essa recusa.
 * Os dois caminhos recusam exatamente os mesmos três estados
 * (`PUBLISHED`, `SUPERSEDED`, `ARCHIVED`).
 */
export function assertDraft(version: MatrixVersion): void {
  if (version.state !== 'DRAFT') {
    throw new DomainError(
      'VERSION_NOT_DRAFT',
      `A versão ${version.number} está em ${version.state}; esta ação só vale enquanto ela é um rascunho.`,
      { versionId: version.id, state: version.state },
    );
  }
}

// ---------------------------------------------------------------------------
// Localização
// ---------------------------------------------------------------------------

export type VersionLocation = {
  matrix: Matrix;
  matrixIndex: number;
  version: MatrixVersion;
  versionIndex: number;
};

export function locateMatrix(
  doc: PolicyOpsDocument,
  matrixId: string,
): { matrix: Matrix; matrixIndex: number } {
  const matrixIndex = doc.matrices.findIndex((candidate) => candidate.id === matrixId);
  if (matrixIndex < 0) {
    throw new DomainError('NOT_FOUND', 'A matriz informada não existe neste documento.', {
      matrixId,
    });
  }
  return { matrix: doc.matrices[matrixIndex]!, matrixIndex };
}

export function locateVersion(doc: PolicyOpsDocument, versionId: string): VersionLocation {
  for (let matrixIndex = 0; matrixIndex < doc.matrices.length; matrixIndex++) {
    const matrix = doc.matrices[matrixIndex]!;
    const versionIndex = matrix.versions.findIndex((candidate) => candidate.id === versionId);
    if (versionIndex >= 0) {
      return { matrix, matrixIndex, version: matrix.versions[versionIndex]!, versionIndex };
    }
  }
  throw new DomainError('NOT_FOUND', 'A versão informada não existe neste documento.', {
    versionId,
  });
}

/** Escopo de auditoria de uma versão: projeto, matriz e versão juntos. */
export function versionScope(matrix: Matrix, versionId: string): DocEvent['scope'] {
  return { projectId: matrix.projectId, matrixId: matrix.id, versionId };
}

// ---------------------------------------------------------------------------
// §1.1 matrix/create
// ---------------------------------------------------------------------------

export type AxisLevelRef = { variableId: string; label?: string };
export type CreateMatrixInput = {
  projectId: string;
  code: string;
  name: string;
  description?: string;
  x: { levels: AxisLevelRef[] };
  y: { levels: AxisLevelRef[] };
  /** Template de origem (docs/05 §1.1 e §8) — aplica `defaults`/`seedRules` ao criar. */
  templateId?: string;
};
export type CreateMatrixData = {
  matrixId: string;
  versionId: string;
  combinations: number;
  /** Só presente quando `templateId` foi informado. */
  skippedRules?: SkippedSeedRule[];
};

function assertCode(code: string): void {
  if (!CODE_REGEX.test(code)) {
    throw new DomainError(
      'INVALID_INPUT',
      `"${code}" não é um código válido: um código casa ^[A-Z0-9_]+$.`,
      { code },
    );
  }
}

function assertText(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${what} não pode ficar em branco.`, { value });
  }
  return trimmed;
}

/**
 * Resolve a `VariableVersion` PUBLISHED e congela os domínios no nível (§1.1.2).
 * Exportada porque `axis/addLevel` (S12) precisa exatamente do mesmo pin e do
 * mesmo snapshot que a criação da matriz — duas resoluções diferentes seriam
 * duas verdades sobre o que é um nível de eixo.
 */
export function resolveLevel(
  doc: PolicyOpsDocument,
  ref: AxisLevelRef,
  // Só o gerador de ids é usado: é o que permite o preview de `axis/addLevel`
  // resolver um nível sem inventar um `Ctx` inteiro.
  ctx: Pick<Ctx, 'newId'>,
): AxisLevel {
  const variable = doc.variables.find((candidate) => candidate.id === ref.variableId);
  if (variable === undefined) {
    throw new DomainError('NOT_FOUND', 'A variável informada não existe neste documento.', {
      variableId: ref.variableId,
    });
  }
  const published = variable.versions.find((candidate) => candidate.state === 'PUBLISHED');
  if (published === undefined) {
    throw new DomainError(
      'VARIABLE_HAS_NO_PUBLISHED_VERSION',
      `A variável "${variable.code}" não tem versão publicada — publique uma antes de usá-la num eixo.`,
      { variableId: variable.id, code: variable.code },
    );
  }
  return {
    id: ctx.newId(),
    variableId: variable.id,
    variableVersionId: published.id,
    label: ref.label === undefined ? variable.name : assertText(ref.label, 'O rótulo do nível'),
    // SNAPSHOT: cópia congelada dos domínios, só identidade — nunca
    // `groupingRanges` (docs/03 §6.1). Publicar uma versão nova da variável
    // depois disso não mexe nesta matriz (docs/05 §5.1).
    domains: snapshotDomains(published.domains),
  };
}

function tupleLevels(levels: AxisLevel[]): TupleLevelInput[] {
  return levels.map((level) => ({ variableId: level.variableId, domains: level.domains }));
}

function buildAxis(role: AxisRole, levels: AxisLevel[], compatibility: PolicyOpsDocument['compatibility']): Axis {
  const generated = generateTuples({
    levels: tupleLevels(levels),
    compatibility: collectPublishedCompatibility(compatibility),
  });
  return {
    role,
    levels,
    tuples: generated.tuples,
    derivedFrom: { compatibilityVersionIds: generated.usedRuleIds },
  };
}

export function createMatrix(input: CreateMatrixInput): Command<CreateMatrixInput, CreateMatrixData> {
  return defineCommand({
    type: 'matrix/create',
    input,
    label: `Criar a matriz "${input.code}"`,
    scope: { projectId: input.projectId },
    execute(doc, ctx) {
      const project = doc.projects.find((candidate) => candidate.id === input.projectId);
      if (project === undefined) {
        throw new DomainError('NOT_FOUND', 'O projeto informado não existe neste documento.', {
          projectId: input.projectId,
        });
      }
      assertCode(input.code);
      const name = assertText(input.name, 'O nome da matriz');

      // 1. Unicidade de `code` no projeto.
      const duplicate = doc.matrices.some(
        (candidate) => candidate.projectId === input.projectId && candidate.code === input.code,
      );
      if (duplicate) {
        throw new DomainError(
          'DUPLICATE_CODE',
          `O projeto "${project.code}" já tem uma matriz com o código "${input.code}".`,
          { code: input.code, projectId: project.id },
        );
      }

      // 2. Resolve as versões PUBLISHED de cada nível.
      const xLevels = input.x.levels.map((ref) => resolveLevel(doc, ref, ctx));
      const yLevels = input.y.levels.map((ref) => resolveLevel(doc, ref, ctx));

      // 3. I13 e I14.
      assertLevelsValid(tupleLevels(xLevels));
      assertLevelsValid(tupleLevels(yLevels));
      assertVariablesNotOnBothAxes(tupleLevels(xLevels), tupleLevels(yLevels));

      // 4. Monta cada eixo com as regras de compatibilidade publicadas.
      const x = buildAxis('X', xLevels, doc.compatibility);
      const y = buildAxis('Y', yLevels, doc.compatibility);

      // 5. I16.
      const combinations = x.tuples.length * y.tuples.length;
      assertGridFits(combinations);

      // 7. Se veio de template, aplica `defaults` e `seedRules` (docs/05 §8) —
      // com as versões publicadas atuais das variáveis, já resolvidas acima.
      let cells: Record<string, Cell> = {};
      let skippedRules: SkippedSeedRule[] | undefined;
      let templateCode: string | undefined;
      if (input.templateId !== undefined) {
        const template = doc.templates.find((candidate) => candidate.id === input.templateId);
        if (template === undefined) {
          throw new DomainError('NOT_FOUND', 'O template informado não existe neste documento.', {
            templateId: input.templateId,
          });
        }
        templateCode = template.code;
        const seeded = buildSeedCells({
          xTuples: x.tuples,
          yTuples: y.tuples,
          defaults: template.defaults,
          seedRules: template.seedRules,
          catalog: doc.catalog,
        });
        cells = seeded.cells;
        skippedRules = seeded.skippedRules;
      }

      // 6. v1 DRAFT — `cells: {}` a menos que um template tenha semeado algo.
      const now = isoFrom(ctx.now());
      const matrixId = ctx.newId();
      const versionId = ctx.newId();
      const version: MatrixVersion = {
        id: versionId,
        number: 1,
        state: 'DRAFT',
        createdAt: now,
        createdBy: ctx.actor,
        axes: { x, y },
        cells,
      };
      const matrix: Matrix = {
        id: matrixId,
        projectId: project.id,
        code: input.code,
        name,
        createdAt: now,
        versions: [version],
      };
      if (input.description !== undefined) {
        matrix.description = assertText(input.description, 'A descrição da matriz');
      }

      const scope = versionScope(matrix, versionId);
      const draftPayload: Record<string, unknown> = { baseVersionNumber: null };
      if (templateCode !== undefined) draftPayload.templateCode = templateCode;
      const events = [
        makeEvent(ctx, {
          type: 'MATRIX_CREATED',
          scope: { projectId: project.id, matrixId },
          summary: `${ctx.actor} criou a matriz "${input.code}" com ${combinations} combinações.`,
          payload: {
            code: input.code,
            name,
            xLevels: xLevels.map((level) => level.label),
            yLevels: yLevels.map((level) => level.label),
            combinations,
          },
        }),
        makeEvent(ctx, {
          type: 'DRAFT_CREATED',
          scope,
          summary: `${ctx.actor} criou o rascunho da versão 1 de "${input.code}".`,
          payload: draftPayload,
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          draft.matrices.push(matrix);
        }),
        data: {
          matrixId,
          versionId,
          combinations,
          ...(skippedRules !== undefined ? { skippedRules } : {}),
        },
        events,
        inverse: removeCreatedMatrix({ matrixId, code: input.code }),
      };
    },
  });
}

/**
 * Inverso de `matrix/create`. Só existe como desfazer: remove uma matriz que
 * ainda tem exatamente a v1 em rascunho, e nunca renumera nada — `Matrix` não
 * tem `position`. Não gera evento (ver a nota sobre o catálogo de eventos em
 * `src/core/command.ts`).
 */
function removeCreatedMatrix(input: { matrixId: string; code: string }): Command<
  { matrixId: string; code: string },
  void
> {
  return defineCommand({
    type: 'matrix/_removeCreated',
    input,
    label: `Desfazer a criação da matriz "${input.code}"`,
    scope: { matrixId: input.matrixId },
    execute(doc) {
      const { matrix, matrixIndex } = locateMatrix(doc, input.matrixId);
      if (matrix.versions.length !== 1 || matrix.versions[0]!.state !== 'DRAFT') {
        throw new DomainError(
          'VERSION_IMMUTABLE',
          `A matriz "${matrix.code}" já tem histórico e não pode ser removida por um desfazer.`,
          { matrixId: matrix.id },
        );
      }
      const removed = structuredClone(matrix);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.matrices.splice(matrixIndex, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreMatrix({ matrix: removed, index: matrixIndex }),
      };
    },
  });
}

/** Refazer de `matrix/_removeCreated`: devolve a matriz idêntica, na posição em que estava. */
function restoreMatrix(input: { matrix: Matrix; index: number }): Command<
  { matrix: Matrix; index: number },
  void
> {
  return defineCommand({
    type: 'matrix/_restore',
    input,
    label: `Refazer a criação da matriz "${input.matrix.code}"`,
    scope: { matrixId: input.matrix.id },
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.matrices.splice(input.index, 0, structuredClone(input.matrix));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedMatrix({ matrixId: input.matrix.id, code: input.matrix.code }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// §1.2 version/createDraft
// ---------------------------------------------------------------------------

export type CreateDraftInput = { matrixId: string; baseVersionId?: string };
export type CreateDraftData = { versionId: string; number: number; baseVersionNumber: number };

/** Clona o eixo integralmente: mesmos pins, mesmos snapshots, **mesmas tuplas**. */
function cloneAxis(axis: Axis, ctx: Ctx): Axis {
  const clone: Axis = {
    role: axis.role,
    // Cada versão tem seus próprios níveis: o id é novo, o conteúdo é idêntico.
    levels: axis.levels.map((level) => ({ ...structuredClone(level), id: ctx.newId() })),
    tuples: [...axis.tuples],
    derivedFrom: { compatibilityVersionIds: [...axis.derivedFrom.compatibilityVersionIds] },
  };
  if (axis.manualSuppressions !== undefined) {
    clone.manualSuppressions = [...axis.manualSuppressions];
  }
  return clone;
}

export function createDraft(input: CreateDraftInput): Command<CreateDraftInput, CreateDraftData> {
  return defineCommand({
    type: 'version/createDraft',
    input,
    label: 'Criar rascunho',
    scope: { matrixId: input.matrixId },
    execute(doc, ctx) {
      const { matrix, matrixIndex } = locateMatrix(doc, input.matrixId);

      // I1: no máximo um rascunho por matriz.
      const existingDraft = matrix.versions.find((version) => version.state === 'DRAFT');
      if (existingDraft !== undefined) {
        throw new DomainError(
          'DRAFT_ALREADY_EXISTS',
          `A matriz "${matrix.code}" já tem a versão ${existingDraft.number} em rascunho.`,
          { matrixId: matrix.id, versionId: existingDraft.id },
        );
      }

      // Base: a informada (inclusive SUPERSEDED — é o "restaurar versão
      // histórica" de §1.2) ou a publicada vigente.
      let base: MatrixVersion | undefined;
      if (input.baseVersionId === undefined) {
        base = matrix.versions.find((version) => version.state === 'PUBLISHED');
      } else {
        base = matrix.versions.find((version) => version.id === input.baseVersionId);
        if (base === undefined) {
          throw new DomainError(
            'NOT_FOUND',
            'A versão de origem informada não pertence a esta matriz.',
            { matrixId: matrix.id, baseVersionId: input.baseVersionId },
          );
        }
      }
      if (base === undefined) {
        throw new DomainError(
          'NO_VERSION_TO_DERIVE',
          `A matriz "${matrix.code}" não tem versão publicada para derivar — informe a versão de origem.`,
          { matrixId: matrix.id },
        );
      }

      const number = Math.max(...matrix.versions.map((version) => version.number)) + 1;
      const versionId = ctx.newId();
      const draft: MatrixVersion = {
        id: versionId,
        number,
        state: 'DRAFT',
        baseVersionId: base.id,
        createdAt: isoFrom(ctx.now()),
        createdBy: ctx.actor,
        axes: { x: cloneAxis(base.axes.x, ctx), y: cloneAxis(base.axes.y, ctx) },
        // Clone integral do mapa de células.
        cells: structuredClone(base.cells),
      };

      const events = [
        makeEvent(ctx, {
          type: 'DRAFT_CREATED',
          scope: versionScope(matrix, versionId),
          summary: `${ctx.actor} criou a versão ${number} de "${matrix.code}" a partir da versão ${base.number}.`,
          payload: { baseVersionNumber: base.number },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft2) => {
          draft2.matrices[matrixIndex]!.versions.push(draft);
        }),
        data: { versionId, number, baseVersionNumber: base.number },
        events,
        inverse: removeCreatedVersion({ matrixId: matrix.id, versionId, number }),
      };
    },
  });
}

/** Inverso de `version/createDraft`: apaga o rascunho recém-criado, sem deixar rastro. */
function removeCreatedVersion(input: { matrixId: string; versionId: string; number: number }): Command<
  { matrixId: string; versionId: string; number: number },
  void
> {
  return defineCommand({
    type: 'version/_removeCreated',
    input,
    label: `Desfazer a criação da versão ${input.number}`,
    scope: { matrixId: input.matrixId, versionId: input.versionId },
    execute(doc) {
      const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);
      assertEditable(version);
      const removed = structuredClone(version);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.matrices[matrixIndex]!.versions.splice(versionIndex, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreVersion({ matrixId: matrix.id, version: removed, index: versionIndex }),
      };
    },
  });
}

/** Refazer de `version/_removeCreated`: devolve a versão idêntica, na posição em que estava. */
function restoreVersion(input: { matrixId: string; version: MatrixVersion; index: number }): Command<
  { matrixId: string; version: MatrixVersion; index: number },
  void
> {
  return defineCommand({
    type: 'version/_restore',
    input,
    label: `Refazer a criação da versão ${input.version.number}`,
    scope: { matrixId: input.matrixId, versionId: input.version.id },
    execute(doc) {
      const { matrixIndex } = locateMatrix(doc, input.matrixId);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.matrices[matrixIndex]!.versions.splice(input.index, 0, structuredClone(input.version));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedVersion({
          matrixId: input.matrixId,
          versionId: input.version.id,
          number: input.version.number,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// §1.3 version/publish
// ---------------------------------------------------------------------------

export type PublishInput = { versionId: string; effectiveFrom?: string; notes: string };
export type PublishData = {
  versionId: string;
  effectiveFrom: string;
  supersededVersionId: string | null;
};

export const MIN_NOTES_LENGTH = 10;

/** A versão publicada vigente da matriz — I2 garante que há no máximo uma. */
function publishedVersionOf(matrix: Matrix): MatrixVersion | undefined {
  return matrix.versions.find((version) => version.state === 'PUBLISHED');
}

const CELL_REF_KINDS: Array<{ field: 'decision' | 'offer' | 'limit'; kind: CatalogItemKind }> = [
  { field: 'decision', kind: 'DECISION' },
  { field: 'offer', kind: 'OFFER' },
  { field: 'limit', kind: 'LIMIT' },
];

export function publishVersion(input: PublishInput): Command<PublishInput, PublishData> {
  return defineCommand({
    type: 'version/publish',
    input,
    label: 'Publicar versão',
    scope: { versionId: input.versionId },
    execute(doc, ctx) {
      const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);

      // As seis validações, na ordem de docs/05 §1.3.
      // 1. versão está em DRAFT
      assertDraft(version);

      // 2. notes com ao menos 10 caracteres
      const notes = input.notes.trim();
      if (notes.length < MIN_NOTES_LENGTH) {
        throw new DomainError(
          'NOTES_REQUIRED',
          `Descreva o que mudou nesta publicação: são necessários ao menos ${MIN_NOTES_LENGTH} caracteres.`,
          { length: notes.length, minimum: MIN_NOTES_LENGTH },
        );
      }

      // 3. zero combinações pendentes (I6)
      const pending = listPending(version);
      if (pending.length > 0) {
        throw new DomainError(
          'UNSET_CELLS_REMAIN',
          `Ainda há ${pending.length} combinação(ões) sem decisão nesta versão.`,
          {
            count: pending.length,
            coords: pending.map(({ xPath, yPath }) => ({ xPath, yPath })),
          },
        );
      }

      // 4. toda chave de `cells` é válida (I5)
      const xTuples = new Set(version.axes.x.tuples);
      const yTuples = new Set(version.axes.y.tuples);
      const invalidKeys = Object.keys(version.cells).filter((key) => {
        const { xPath, yPath } = decodeCellKey(key);
        return !xTuples.has(xPath) || !yTuples.has(yPath);
      });
      if (invalidKeys.length > 0) {
        throw new DomainError(
          'CELL_GRID_INCONSISTENT',
          `${invalidKeys.length} célula(s) desta versão não correspondem a nenhuma combinação dos eixos.`,
          { keys: invalidKeys },
        );
      }

      // 5. toda referência a catálogo existe (I17)
      const missingRefs: Array<{ key: string; field: string; code: string }> = [];
      for (const [key, cell] of Object.entries(version.cells)) {
        for (const { field, kind } of CELL_REF_KINDS) {
          const code = cell[field];
          if (code === undefined) continue;
          const item = doc.catalog.find(
            (candidate) => candidate.kind === kind && candidate.code === code,
          );
          if (item === undefined) missingRefs.push({ key, field, code });
        }
      }
      if (missingRefs.length > 0) {
        throw new DomainError(
          'CATALOG_REF_MISSING',
          `${missingRefs.length} referência(s) a itens de catálogo inexistentes impedem a publicação.`,
          { refs: missingRefs },
        );
      }

      // 6. effectiveFrom ≥ agora e > effectiveFrom da vigente
      const now = ctx.now();
      const current = publishedVersionOf(matrix);
      let effectiveFrom = now;
      if (input.effectiveFrom !== undefined) {
        if (!ISO_DATE_REGEX.test(input.effectiveFrom)) {
          throw new DomainError(
            'INVALID_INPUT',
            'A data de vigência precisa estar no formato ISO 8601 UTC.',
            { effectiveFrom: input.effectiveFrom },
          );
        }
        effectiveFrom = new Date(input.effectiveFrom);
        // Publicação retroativa é proibida; agendamento futuro é permitido.
        if (effectiveFrom.getTime() < now.getTime()) {
          throw new DomainError(
            'EFFECTIVE_DATE_INVALID',
            'A vigência não pode ser retroativa — informe uma data a partir de agora.',
            { effectiveFrom: input.effectiveFrom, now: isoFrom(now) },
          );
        }
      }
      const effectiveFromISO = isoFrom(effectiveFrom);
      if (current !== undefined && effectiveFromISO <= current.effectiveFrom!) {
        throw new DomainError(
          'EFFECTIVE_DATE_INVALID',
          `A vigência precisa começar depois de ${current.effectiveFrom}, início da versão ${current.number}.`,
          { effectiveFrom: effectiveFromISO, currentEffectiveFrom: current.effectiveFrom },
        );
      }

      // Efeitos.
      const nowISO = isoFrom(now);
      const events: DocEvent[] = [];
      if (current !== undefined) {
        events.push(
          makeEvent(ctx, {
            type: 'VERSION_SUPERSEDED',
            scope: versionScope(matrix, current.id),
            summary: `A versão ${current.number} de "${matrix.code}" foi substituída pela versão ${version.number}.`,
            payload: { byVersionNumber: version.number, effectiveTo: effectiveFromISO },
          }),
        );
      }
      // `diffSummary` contra a versão que está sendo substituída — o resumo
      // semântico de §4.3, calculado com as duas versões ainda no estado
      // anterior à publicação. Sem vigente para comparar (a v1 de uma matriz
      // nova), fica `null`: não há "antes".
      const diff = current === undefined
        ? null
        : diffVersionPair({ a: doc, b: doc }, { matrix, version: current }, { matrix, version });

      events.push(
        makeEvent(ctx, {
          type: 'VERSION_PUBLISHED',
          scope: versionScope(matrix, version.id),
          summary: `${ctx.actor} publicou a versão ${version.number} de "${matrix.code}", vigente a partir de ${effectiveFromISO}.`,
          payload: {
            effectiveFrom: effectiveFromISO,
            diffSummary: diff === null || !diff.comparable ? null : diff.summary,
            diffSummaryText: diff === null ? [] : diff.summaryText,
          },
        }),
      );

      const currentIndex =
        current === undefined
          ? -1
          : matrix.versions.findIndex((candidate) => candidate.id === current.id);

      return {
        document: applyToDocument(doc, events, (draft) => {
          const versions = draft.matrices[matrixIndex]!.versions;
          if (currentIndex >= 0) {
            const superseded = versions[currentIndex]!;
            superseded.state = 'SUPERSEDED';
            superseded.effectiveTo = effectiveFromISO;
          }
          const published = versions[versionIndex]!;
          published.state = 'PUBLISHED';
          published.notes = notes;
          published.publishedAt = nowISO;
          published.publishedBy = ctx.actor;
          published.effectiveFrom = effectiveFromISO;
        }),
        data: {
          versionId: version.id,
          effectiveFrom: effectiveFromISO,
          supersededVersionId: current === undefined ? null : current.id,
        },
        events,
        inverse: irreversible(
          'Publicar uma versão não pode ser desfeito. Para voltar atrás, crie um rascunho a partir da versão anterior e publique-o.',
        ),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// §1.4 version/discardDraft
// ---------------------------------------------------------------------------

export type DiscardDraftInput = { versionId: string };
export type DiscardDraftData = { versionId: string; number: number; editedCells: number };

export function discardDraft(input: DiscardDraftInput): Command<DiscardDraftInput, DiscardDraftData> {
  return defineCommand({
    type: 'version/discardDraft',
    input,
    label: 'Descartar rascunho',
    scope: { versionId: input.versionId },
    execute(doc, ctx) {
      const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);
      assertDraft(version);

      const editedCells = Object.keys(version.cells).length;
      const archivedAt = isoFrom(ctx.now());
      const events = [
        makeEvent(ctx, {
          type: 'DRAFT_DISCARDED',
          scope: versionScope(matrix, version.id),
          summary: `${ctx.actor} descartou a versão ${version.number} de "${matrix.code}" — o número não será reutilizado.`,
          payload: { editedCells },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          // O número é **queimado**: a versão continua na lista, em ARCHIVED,
          // e a próxima pula. Número de versão nunca se reutiliza (§1.4).
          const archived = draft.matrices[matrixIndex]!.versions[versionIndex]!;
          archived.state = 'ARCHIVED';
          archived.archivedAt = archivedAt;
        }),
        data: { versionId: version.id, number: version.number, editedCells },
        events,
        inverse: irreversible(
          'Descartar um rascunho não pode ser desfeito: o número da versão é queimado e nunca se reutiliza.',
        ),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// version/addNote
// ---------------------------------------------------------------------------

export type AddNoteInput = { versionId: string; text: string };

/**
 * Anota no histórico da versão. Não toca a `MatrixVersion` — só acrescenta um
 * `DocEvent` —, e por isso vale em qualquer estado sem ferir I3. O campo
 * `notes` da versão é a nota de publicação, escrita por `version/publish`.
 */
export function addNote(input: AddNoteInput): Command<AddNoteInput, { eventId: string }> {
  return defineCommand({
    type: 'version/addNote',
    input,
    label: 'Anotar no histórico',
    scope: { versionId: input.versionId },
    execute(doc, ctx) {
      const { matrix, version } = locateVersion(doc, input.versionId);
      const text = assertText(input.text, 'A anotação');
      const event = makeEvent(ctx, {
        type: 'NOTE_ADDED',
        scope: versionScope(matrix, version.id),
        summary: `${ctx.actor} anotou na versão ${version.number} de "${matrix.code}": ${text}`,
        payload: { text },
      });
      return {
        document: applyToDocument(doc, [event], () => {}),
        data: { eventId: event.id },
        events: [event],
        inverse: irreversible('O histórico é append-only: uma anotação registrada não pode ser removida.'),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Consultas de apoio
// ---------------------------------------------------------------------------

/** Combinações sem decisão nesta versão — pendência é derivada, nunca armazenada (§2.1). */
export function pendingCoords(version: MatrixVersion): CellCoord[] {
  return listPending(version).map(({ xPath, yPath }) => ({ xPath, yPath }));
}

/** Total de combinações do grid: `x.tuples × y.tuples`. */
export function combinationCount(version: MatrixVersion): number {
  return allCombinations(version).length;
}
