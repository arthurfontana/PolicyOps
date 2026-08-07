import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Grid,
  HEADER_ROW_HEIGHT,
  Y_HEADER_COL_WIDTH,
  type GridDiffOverlay,
} from '@/components/grid/Grid';
import type { CellChange, VersionDiff } from '@/core/diff/types';
import type { EditorView } from '@/core/queries';
import { axisStackLabel, buildDiffMarks, DIFF_LEGEND } from '@/lib/diff-view';
import { DiffCellDetail } from './DiffCellDetail';
import { DiffList } from './DiffList';

/**
 * A tela de comparação — docs/07-ux-e-editor.md §9.
 *
 * Componente de apresentação: recebe o `VersionDiff` e as duas `EditorView`
 * já resolvidas, e não conhece store nenhum. É o que permite montá-lo tanto
 * na rota `compare` quanto dentro do diálogo de conflito de salvamento
 * (docs/06 §5), onde uma das pontas vem de um documento que não está aberto.
 */

export type CompareMode = 'overlay' | 'side-by-side' | 'list';

const MODE_LABEL: Record<CompareMode, string> = {
  overlay: 'Sobreposto',
  'side-by-side': 'Lado a lado',
  list: 'Lista',
};

export interface CompareViewProps {
  diff: VersionDiff;
  aView: EditorView;
  bView: EditorView;
  aLabel: string;
  bLabel: string;
  /** Seletores de versão e ações, renderizados acima dos cards do resumo. */
  header?: ReactNode;
  /**
   * Mostra o "antes → depois" numa coluna própria. A rota usa o inspector do
   * shell (`false`); o diálogo de conflito não tem inspector e usa `true`.
   */
  inlineDetail?: boolean;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
}

export function CompareView({
  diff,
  aView,
  bView,
  aLabel,
  bLabel,
  header,
  inlineDetail = false,
  selectedKey,
  onSelectKey,
}: CompareViewProps) {
  const [requestedMode, setRequestedMode] = useState<CompareMode>('overlay');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Versões incomparáveis não têm diff de células para sobrepor: a única
  // leitura honesta é ver os dois grids inteiros, lado a lado (§9).
  const mode: CompareMode = diff.comparable ? requestedMode : 'side-by-side';

  const marks = useMemo(() => buildDiffMarks(diff), [diff]);
  const changeByKey = useMemo(() => {
    const byKey = new Map<string, CellChange>();
    for (const change of diff.cells) byKey.set(change.key, change);
    return byKey;
  }, [diff]);

  const selectedChange = selectedKey === null ? null : (changeByKey.get(selectedKey) ?? null);

  // --- Rolagem sincronizada do modo lado a lado ----------------------------
  //
  // Os dois grids podem ter números de níveis diferentes (é exatamente o caso
  // quando as versões são incomparáveis), então os cabeçalhos têm alturas e
  // larguras diferentes. Sincronizar `scrollTop` cru desalinharia as linhas:
  // o que se espelha é o deslocamento **dentro da área de dados**.
  const scrollA = useRef<HTMLDivElement | null>(null);
  const scrollB = useRef<HTMLDivElement | null>(null);
  const syncing = useRef(false);

  const registerA = useCallback((element: HTMLDivElement | null) => {
    scrollA.current = element;
  }, []);
  const registerB = useCallback((element: HTMLDivElement | null) => {
    scrollB.current = element;
  }, []);

  const offsets = useMemo(
    () => ({
      a: { top: aView.x.levelCount * HEADER_ROW_HEIGHT, left: aView.y.levelCount * Y_HEADER_COL_WIDTH },
      b: { top: bView.x.levelCount * HEADER_ROW_HEIGHT, left: bView.y.levelCount * Y_HEADER_COL_WIDTH },
    }),
    [aView.x.levelCount, aView.y.levelCount, bView.x.levelCount, bView.y.levelCount],
  );

  useEffect(() => {
    if (mode !== 'side-by-side') return;
    const left = scrollA.current;
    const right = scrollB.current;
    if (left === null || right === null) return;

    function mirror(source: HTMLDivElement, target: HTMLDivElement, from: { top: number; left: number }, to: { top: number; left: number }) {
      if (syncing.current) return;
      syncing.current = true;
      target.scrollTop = Math.max(0, source.scrollTop - from.top + to.top);
      target.scrollLeft = Math.max(0, source.scrollLeft - from.left + to.left);
      // O `scroll` disparado pela atribuição acima chega no mesmo quadro; o
      // flag só cai depois dele, senão os dois lados se empurram sem fim.
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    }

    const onLeftScroll = () => mirror(left, right, offsets.a, offsets.b);
    const onRightScroll = () => mirror(right, left, offsets.b, offsets.a);
    left.addEventListener('scroll', onLeftScroll);
    right.addEventListener('scroll', onRightScroll);
    return () => {
      left.removeEventListener('scroll', onLeftScroll);
      right.removeEventListener('scroll', onRightScroll);
    };
  }, [mode, offsets]);

  function overlayFor(side: 'a' | 'b'): GridDiffOverlay {
    return {
      marks,
      selectedKey,
      onSelectKey: (key) => onSelectKey(key),
      onlyChanged,
      hoverKey,
      onHoverKey: setHoverKey,
      registerScrollElement: side === 'a' ? registerA : registerB,
    };
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b border-neutral-200 p-3 dark:border-neutral-800">
        {header}

        <SummaryCards diff={diff} />

        {!diff.comparable && (
          <Alert variant="destructive" data-testid="incomparable-banner">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Estas versões não podem ser comparadas célula a célula</AlertTitle>
            <AlertDescription>
              As pilhas de variáveis dos eixos são diferentes, então as mesmas coordenadas
              significam coisas diferentes em cada versão. Eixo X: "{axisStackLabel(aView, 'x')}"
              contra "{axisStackLabel(bView, 'x')}". Eixo Y: "{axisStackLabel(aView, 'y')}" contra
              "{axisStackLabel(bView, 'y')}". Os dois grids aparecem lado a lado, inteiros.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            value={mode}
            onValueChange={(value) => setRequestedMode(value as CompareMode)}
          >
            <TabsList>
              {(Object.keys(MODE_LABEL) as CompareMode[]).map((value) => (
                <TabsTrigger key={value} value={value} disabled={!diff.comparable && value !== 'side-by-side'}>
                  {MODE_LABEL[value]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {mode !== 'list' && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="compare-only-changed"
                checked={onlyChanged}
                onCheckedChange={(checked) => setOnlyChanged(checked === true)}
                disabled={!diff.comparable}
              />
              <Label htmlFor="compare-only-changed" className="text-xs font-normal">
                Mostrar apenas alteradas
              </Label>
            </div>
          )}

          <DiffLegend />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          {mode === 'list' && (
            <DiffList
              changes={diff.cells}
              aView={aView}
              bView={bView}
              aLabel={aLabel}
              bLabel={bLabel}
              selectedKey={selectedKey}
              onSelectKey={onSelectKey}
            />
          )}

          {mode === 'overlay' && (
            <div className="flex h-full min-h-0 flex-col" data-testid="compare-overlay">
              <GridPaneHeader label={`${aLabel} → ${bLabel}`} />
              <div className="min-h-0 flex-1">
                <Grid view={bView} zoom={1} hideFooter diffOverlay={overlayFor('b')} />
              </div>
            </div>
          )}

          {mode === 'side-by-side' && (
            <div className="flex h-full min-h-0" data-testid="compare-side-by-side">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-neutral-200 dark:border-neutral-800">
                <GridPaneHeader label={aLabel} />
                <div className="min-h-0 flex-1">
                  <Grid view={aView} zoom={1} hideFooter diffOverlay={overlayFor('a')} />
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <GridPaneHeader label={bLabel} />
                <div className="min-h-0 flex-1">
                  <Grid view={bView} zoom={1} hideFooter diffOverlay={overlayFor('b')} />
                </div>
              </div>
            </div>
          )}
        </div>

        {inlineDetail && (
          <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-neutral-200 p-3 dark:border-neutral-800">
            <DiffCellDetail
              change={selectedChange}
              aView={aView}
              bView={bView}
              aLabel={aLabel}
              bLabel={bLabel}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

function GridPaneHeader({ label }: { label: string }) {
  return (
    <div className="shrink-0 border-b border-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
      {label}
    </div>
  );
}

function DiffLegend() {
  return (
    <ul className="ml-auto flex flex-wrap items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
      {DIFF_LEGEND.map((entry) => (
        <li key={entry.kind} className="flex items-center gap-1.5">
          <span aria-hidden className={`h-3 w-3 rounded-sm ${entry.swatch}`} />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

/** Os cards do resumo semântico — as frases prontas de §4.3, uma por card. */
function SummaryCards({ diff }: { diff: VersionDiff }) {
  if (!diff.comparable) return null;
  if (diff.summaryText.length === 0) {
    return (
      <p data-testid="diff-summary-cards" className="text-sm text-neutral-500 dark:text-neutral-400">
        Nada mudou entre estas duas versões.
      </p>
    );
  }
  return (
    <ul data-testid="diff-summary-cards" className="flex flex-wrap gap-2">
      {diff.summaryText.map((phrase) => {
        const [count, ...rest] = phrase.split(' ');
        return (
          <li
            key={phrase}
            className="flex min-w-[7.5rem] flex-col rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
          >
            <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
              {count}
            </span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{rest.join(' ')}</span>
          </li>
        );
      })}
    </ul>
  );
}
