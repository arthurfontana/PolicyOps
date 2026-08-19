import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Grid } from '@/components/grid/Grid';
import { ComponentPayloadFields } from '@/components/inspector/ComponentPayloadFields';
import { RichDocEditor } from '@/components/richdoc/RichDocEditor';
import { TreeNodeRow } from '@/components/tree/TreeNodeRow';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { getEditorView } from '@/core/queries';
import type { PolicySnapshotNode } from '@/core/timeline/policy-at';
import type { StructureRow } from '@/components/timeline/policy-structure-rows';
import { COMPONENT_TYPE_ICONS, COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { formatDateBR } from '@/lib/format';
import { formatDateInputBR } from '@/lib/timeline-dates';

/**
 * Aba **Estrutura** da tela de Vigência — docs/07-ux-e-editor.md §10,
 * DEC-UX-004. A política inteira na data escolhida: seções, regras, listas,
 * variáveis e matrizes na mesma árvore, cada uma com o que era naquele dia.
 *
 * Nenhuma regra mora aqui: `getPolicyAt` (`src/core/timeline/policy-at.ts`,
 * docs/05 §6.2) já respondeu, e esta tela lê e desenha — no **mesmo** nó da
 * árvore da barra lateral (`TreeNodeRow`), em modo leitura. Nada se edita:
 * o caminho de edição é "Abrir no editor (hoje)".
 */

// ---------------------------------------------------------------------------
// Árvore da data
// ---------------------------------------------------------------------------
// #region: arvore-da-data

/**
 * O que o nó era na data (docs/07 §10). Três leituras, e a terceira é a que
 * I29 exige: seção pura é **estrutura**, nunca "sem política vigente" — dizer
 * o contrário faria toda pasta parecer uma regra que caducou.
 */
export function SnapshotBadge({ node, date }: { node: PolicySnapshotNode; date: string }) {
  if (node.status === 'STRUCTURE') {
    return (
      <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
        estrutura
      </Badge>
    );
  }
  if (node.status === 'ABSENT') {
    return (
      <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
        sem política vigente em {formatDateInputBR(date)}
      </Badge>
    );
  }
  const number = node.kind === 'MATRIX' ? node.matrixVersion?.number : node.version?.number;
  return (
    <Badge variant="green" className="shrink-0 px-1.5 py-0 text-[10px]">
      v{number}
    </Badge>
  );
}

export function PolicyStructureTree({
  rows,
  date,
  selectedKey,
  onSelect,
}: {
  rows: StructureRow[];
  date: string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400">
        Nenhum componente existia em {formatDateInputBR(date)}.
      </p>
    );
  }

  return (
    <div role="tree" aria-label={`Política em ${formatDateInputBR(date)}`} className="flex flex-col">
      {rows.map((row) => (
        <TreeNodeRow
          key={row.key}
          role="treeitem"
          aria-selected={selectedKey === row.key}
          tabIndex={0}
          data-testid={`policy-at-node-${row.code}`}
          title={`${row.name} · ${row.code}`}
          depth={row.depth}
          icon={COMPONENT_TYPE_ICONS[row.type ?? 'MATRIX']}
          name={row.name}
          code={row.code}
          showCode
          selected={selectedKey === row.key}
          dimmed={row.dimmed}
          onClick={() => onSelect(row.key)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onSelect(row.key);
          }}
          badges={<SnapshotBadge node={row.node} date={date} />}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leitura do nó selecionado
// ---------------------------------------------------------------------------
// #region: leitura-do-no

/**
 * O conteúdo daquela versão, somente leitura (§10): payload campo a campo e
 * especificação rica no componente, o grid da versão vigente na matriz —
 * sempre com o banner de versão histórica e a marca d'água.
 */
export function PolicyStructureDetail({
  document,
  row,
  date,
  onOpenEditor,
}: {
  document: PolicyOpsDocument;
  row: StructureRow | null;
  date: string;
  onOpenEditor: (node: PolicySnapshotNode) => void;
}) {
  const { node } = row ?? { node: null };

  const matrixView = useMemo(() => {
    if (node === null || node.matrixVersion === null) return null;
    return getEditorView(document, node.matrixVersion.id);
  }, [document, node]);

  if (row === null || node === null) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Escolha um item da árvore para ver como ele era em {formatDateInputBR(date)}.
        </p>
      </div>
    );
  }

  const version = node.kind === 'MATRIX' ? node.matrixVersion : node.version;
  const isHistorical = version !== null && version.effectiveTo !== undefined;

  return (
    <div className="relative flex h-full flex-col gap-4 overflow-y-auto p-5" data-testid="policy-at-detail">
      {isHistorical && (
        <div
          aria-hidden
          data-testid="policy-at-watermark"
          className="pointer-events-none absolute inset-0 z-10 flex select-none items-center justify-center overflow-hidden print:hidden"
        >
          <span className="rotate-[-25deg] whitespace-nowrap text-7xl font-black uppercase tracking-widest text-neutral-900/[0.05] dark:text-neutral-100/[0.07]">
            HISTÓRICO
          </span>
        </div>
      )}

      <div className="relative z-20 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{row.name}</h2>
        <span className="font-mono text-xs text-neutral-400">{row.code}</span>
        <Badge variant="outline">{COMPONENT_TYPE_LABELS[row.type ?? 'MATRIX']}</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => onOpenEditor(node)}
        >
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir no editor (hoje)
        </Button>
      </div>

      {version !== null && (
        <p
          data-testid="policy-at-banner"
          className="relative z-20 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
        >
          {isHistorical
            ? `Você está vendo a versão ${version.number}, vigente de ${formatDateBR(version.effectiveFrom!)} a ${formatDateBR(version.effectiveTo!)}. Esta é uma versão histórica.`
            : `Você está vendo a versão ${version.number}, vigente desde ${formatDateBR(version.effectiveFrom!)} — ainda é a versão vigente hoje.`}
        </p>
      )}

      {node.status === 'STRUCTURE' && (
        <p className="relative z-20 text-sm text-neutral-500 dark:text-neutral-400">
          Seção sem texto próprio — estrutura, não conteúdo.
        </p>
      )}

      {node.status === 'ABSENT' && (
        <p className="relative z-20 text-sm text-neutral-500 dark:text-neutral-400">
          Sem política vigente em {formatDateInputBR(date)}.
        </p>
      )}

      {node.kind === 'COMPONENT' && node.version !== null && (
        <div className="relative z-20 flex flex-col gap-4">
          <ComponentPayloadFields
            key={node.version.id}
            payload={node.version.payload}
            editable={false}
            /* Somente leitura: nenhum campo é editável, então nada chama `onChange`. */
            onChange={() => undefined}
            layout="wide"
          />
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-semibold">Especificação</Label>
            <RichDocEditor
              key={node.version.id}
              target={{ kind: 'COMPONENT_VERSION_SPEC', versionId: node.version.id }}
              value={node.version.spec}
              editable={false}
              emptyLabel="Esta versão não tem especificação livre."
            />
          </div>
        </div>
      )}

      {node.kind === 'MATRIX' && matrixView !== null && (
        <div className="relative z-20 min-h-[16rem] flex-1 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
          <Grid view={matrixView} zoom={1} />
        </div>
      )}
    </div>
  );
}
