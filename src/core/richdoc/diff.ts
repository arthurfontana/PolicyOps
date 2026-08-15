import type { Block, RichDoc } from '../document/schema';
import { blockPlainText, sameBlockContent } from './model';

/**
 * Diff de `RichDoc` — **por bloco**, nunca intra-texto (docs/14 §7, fora do
 * escopo da fase 1). Base para o "hoje × proposto" da S36 e para a fotografia
 * histórica da S39.
 *
 * **Movimento é detectado** (decisão da S34, DEC-GOV-029): um bloco que existe
 * dos dois lados com o **mesmo id** e o mesmo conteúdo, em posição diferente,
 * é `MOVED` — não um `REMOVED` seguido de um `ADDED`. O id do bloco é estável
 * por contrato (docs/03 §12.3), então essa informação está disponível de
 * graça, e jogá-la fora produziria o pior tipo de diff: reordenar dois
 * parágrafos apareceria como "dois blocos apagados e dois criados", e quem
 * revisa teria de reler texto que não mudou. Quando conteúdo **e** posição
 * mudam, o resultado é `CHANGED` com `moved: true` — uma mudança só, com a
 * observação de que ela também trocou de lugar.
 *
 * Bloco cujo `id` não existe do outro lado é `ADDED`/`REMOVED` — inclusive
 * quando o conteúdo é idêntico ao de outro bloco: sem o id, "é o mesmo
 * parágrafo?" vira adivinhação, e adivinhar num diff de política é pior do que
 * mostrar uma linha a mais.
 */

export type RichDocChangeKind = 'ADDED' | 'REMOVED' | 'CHANGED' | 'MOVED' | 'UNCHANGED';

export type RichDocBlockChange = {
  kind: RichDocChangeKind;
  blockId: string;
  /** Posição no lado A (base). `null` quando o bloco não existe lá. */
  indexBefore: number | null;
  /** Posição no lado B (comparado). `null` quando o bloco não existe lá. */
  indexAfter: number | null;
  before: Block | null;
  after: Block | null;
  /** Só em `CHANGED`: o bloco também trocou de posição. */
  moved?: boolean;
};

export type RichDocDiff = {
  changes: RichDocBlockChange[];
  totals: Record<RichDocChangeKind, number>;
  hasChanges: boolean;
};

const EMPTY: RichDoc = { blocks: [] };

/**
 * A ordem da saída é a do lado B (o comparado), que é a leitura natural do
 * documento novo; os removidos entram na posição em que estavam em A, logo
 * depois do bloco que os precedia — é assim que a tela lado a lado consegue
 * alinhar as duas colunas sem recalcular nada.
 */
export function diffRichDoc(before: RichDoc | undefined, after: RichDoc | undefined): RichDocDiff {
  const a = before ?? EMPTY;
  const b = after ?? EMPTY;

  const indexInA = new Map(a.blocks.map((block, index) => [block.id, index] as const));
  const indexInB = new Map(b.blocks.map((block, index) => [block.id, index] as const));

  // Movimento é mudança de **ordem relativa** entre os blocos que existem dos
  // dois lados, não de índice absoluto: apagar o primeiro parágrafo empurra
  // todos os outros um índice para cima, e chamar isso de "moveu" encheria o
  // diff de ruído.
  const rankInA = rankOfCommonBlocks(a, indexInB);
  const rankInB = rankOfCommonBlocks(b, indexInA);

  const changes: RichDocBlockChange[] = [];

  /** Removidos ainda não emitidos, agrupados pela posição em A que os antecede. */
  const removedAfterIndex = new Map<number, RichDocBlockChange[]>();
  for (const [index, block] of a.blocks.entries()) {
    if (indexInB.has(block.id)) continue;
    const anchor = previousSurvivorIndex(a, indexInB, index);
    const bucket = removedAfterIndex.get(anchor) ?? [];
    bucket.push({
      kind: 'REMOVED',
      blockId: block.id,
      indexBefore: index,
      indexAfter: null,
      before: block,
      after: null,
    });
    removedAfterIndex.set(anchor, bucket);
  }

  // Removidos que vinham antes de qualquer bloco sobrevivente abrem a lista.
  changes.push(...(removedAfterIndex.get(-1) ?? []));

  for (const [index, block] of b.blocks.entries()) {
    const beforeIndex = indexInA.get(block.id);
    if (beforeIndex === undefined) {
      changes.push({
        kind: 'ADDED',
        blockId: block.id,
        indexBefore: null,
        indexAfter: index,
        before: null,
        after: block,
      });
      continue;
    }
    const previous = a.blocks[beforeIndex]!;
    const sameContent = sameBlockContent(previous, block);
    const moved = rankInA.get(block.id) !== rankInB.get(block.id);
    const change: RichDocBlockChange = {
      kind: sameContent ? (moved ? 'MOVED' : 'UNCHANGED') : 'CHANGED',
      blockId: block.id,
      indexBefore: beforeIndex,
      indexAfter: index,
      before: previous,
      after: block,
    };
    if (!sameContent && moved) change.moved = true;
    changes.push(change);
    changes.push(...(removedAfterIndex.get(beforeIndex) ?? []));
  }

  const totals: Record<RichDocChangeKind, number> = {
    ADDED: 0,
    REMOVED: 0,
    CHANGED: 0,
    MOVED: 0,
    UNCHANGED: 0,
  };
  for (const change of changes) totals[change.kind] += 1;

  return { changes, totals, hasChanges: totals.ADDED + totals.REMOVED + totals.CHANGED + totals.MOVED > 0 };
}

/** Índice, em A, do último bloco anterior a `index` que sobreviveu em B (`-1` se nenhum). */
function previousSurvivorIndex(a: RichDoc, indexInB: Map<string, number>, index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (indexInB.has(a.blocks[cursor]!.id)) return cursor;
  }
  return -1;
}

/** Posição de cada bloco **entre os que existem dos dois lados**, 0-based. */
function rankOfCommonBlocks(side: RichDoc, otherIndex: Map<string, number>): Map<string, number> {
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const block of side.blocks) {
    if (!otherIndex.has(block.id)) continue;
    ranks.set(block.id, rank);
    rank += 1;
  }
  return ranks;
}

/** Resumo de uma linha para as telas de comparação e para o log da S37. */
export function describeBlockChange(change: RichDocBlockChange): string {
  const block = change.after ?? change.before;
  const text = block === null ? '' : blockPlainText(block).replace(/\s+/g, ' ').trim();
  const excerpt = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  switch (change.kind) {
    case 'ADDED':
      return `Bloco novo: ${excerpt || '(vazio)'}`;
    case 'REMOVED':
      return `Bloco removido: ${excerpt || '(vazio)'}`;
    case 'MOVED':
      return `Bloco movido: ${excerpt || '(vazio)'}`;
    case 'CHANGED':
      return `Bloco alterado: ${excerpt || '(vazio)'}`;
    case 'UNCHANGED':
      return excerpt;
  }
}
