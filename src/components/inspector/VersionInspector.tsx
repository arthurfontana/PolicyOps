import { Badge } from '@/components/ui/badge';
import { AxisEditor } from '@/components/editor/AxisEditor';
import { EvidenceSection } from '@/components/inspector/EvidenceSection';
import { MatrixTagsEditor } from '@/components/inspector/MatrixTagsEditor';
import type { AxisRole } from '@/core/document/schema';
import { getEditorView, getImportOrigin, type EditorAxisView } from '@/core/queries';
import { formatDateBR, formatDateTimeBR } from '@/lib/format';
import { versionBadge } from '@/lib/matrix-badges';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * Propriedades da versão, sem seleção — docs/07-ux-e-editor.md §6.1. As ações
 * de ciclo de vida vivem na barra superior da tela de matriz
 * (docs/prompts/S13-ciclo-de-vida.md item 1) — aqui fica só o que é
 * informação: eixos, estatísticas e notas.
 */

const AXIS_ROLE_LABEL: Record<AxisRole, string> = { X: 'Eixo X (colunas)', Y: 'Eixo Y (linhas)' };

/**
 * Eixo em modo leitura — versão publicada, histórica ou descartada. **Sem
 * badge de defasagem**: essas versões são registro, não pendência (§5.2), e é
 * por isso que esta variante nem recebe a defasagem como propriedade.
 */
function AxisSection({ role, axisView }: { role: AxisRole; axisView: EditorAxisView }) {
  const suppressions = axisView.axis.manualSuppressions?.length ?? 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          {AXIS_ROLE_LABEL[role]}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {axisView.axis.levels.map((level, index) => (
          <li key={level.id} className="text-xs text-neutral-600 dark:text-neutral-400">
            Nível {index}: <span className="font-medium text-neutral-900 dark:text-neutral-100">{level.label}</span>{' '}
            · {level.domains.length} domínios
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {axisView.tupleCount} tuplas
        {suppressions > 0 ? ` · ${suppressions} suprimida(s) manualmente` : ''}
      </p>
    </div>
  );
}

export function VersionInspector() {
  const document = useDocumentStore((s) => s.document);
  const currentVersionId = useEditorStore((s) => s.currentVersionId);

  if (document === null || currentVersionId === null) return null;

  const view = getEditorView(document, currentVersionId);
  // A origem do rascunho: qual carga o criou (docs/12 §6.2). `null` quando ele
  // nasceu à mão, que é o caso de todo rascunho fora do fluxo de carga.
  const importOrigin = getImportOrigin(document, currentVersionId);
  const { matrix, version, project, stats } = view;
  const badge = versionBadge(version);

  const decisionCounts = new Map<string, number>();
  for (const cell of Object.values(view.cells)) {
    if (cell.decision === undefined) continue;
    decisionCounts.set(cell.decision, (decisionCounts.get(cell.decision) ?? 0) + 1);
  }
  const filledPercent = stats.combinations === 0 ? 0 : Math.round((stats.filledCells / stats.combinations) * 100);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{matrix.name}</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {matrix.code} · {project?.name ?? 'sem projeto'}
        </p>
        {matrix.description !== undefined && (
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{matrix.description}</p>
        )}
        <Badge variant={badge.variant} className={`mt-2 ${badge.strike ? 'line-through' : ''}`}>
          {badge.label}
        </Badge>
      </div>

      <MatrixTagsEditor matrix={matrix} />

      <div className="flex flex-col gap-2">
        {view.editable ? (
          <>
            <AxisEditor role="X" view={view} staleness={view.staleness?.x ?? null} />
            <AxisEditor role="Y" view={view} staleness={view.staleness?.y ?? null} />
          </>
        ) : (
          <>
            <AxisSection role="X" axisView={view.x} />
            <AxisSection role="Y" axisView={view.y} />
          </>
        )}
      </div>

      {/* Barra de pendências: depois de uma operação de nível é ela que diz
          quanto trabalho a operação criou (docs/prompts/S12, item 4). A barra
          dedicada de pendências para publicação mora na tela de matriz, acima
          do grid (docs/prompts/S13, item 2). */}

      <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
        <span className="font-semibold text-neutral-700 dark:text-neutral-300">Estatísticas</span>
        <span className="text-neutral-600 dark:text-neutral-400">
          {stats.combinations} combinações · {filledPercent}% preenchida
        </span>
        <span className="text-neutral-600 dark:text-neutral-400">{stats.pendingCells} pendentes</span>
        {decisionCounts.size > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5">
            {[...decisionCounts.entries()].map(([code, count]) => {
              const item = view.catalog.byCode.DECISION[code];
              return (
                <li key={code} className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
                  <span>{item?.label ?? code}</span>
                  <span>{count}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {importOrigin !== null && (
        <div
          className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
          data-testid="version-import-origin"
        >
          <span className="font-semibold text-neutral-700 dark:text-neutral-300">Origem</span>
          <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">
            Criado pela carga {importOrigin.profileCode} em {formatDateBR(importOrigin.at)}
          </p>
        </div>
      )}

      {/* Evidências (docs/14 §7): as da versão são o caso típico — o DB que
          justificou aquela publicação —, e as da matriz valem para todas as
          versões (um ofício que rege a política inteira). */}
      <EvidenceSection
        target={{ kind: 'VERSION', matrixId: matrix.id, versionNumber: version.number }}
        title={`Evidências da versão ${version.number}`}
      />
      <EvidenceSection target={{ kind: 'MATRIX', matrixId: matrix.id }} title="Evidências da matriz" />

      {version.notes !== undefined && (
        <div className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
          <span className="font-semibold text-neutral-700 dark:text-neutral-300">Notas</span>
          <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">{version.notes}</p>
        </div>
      )}

      <div className="flex flex-col gap-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          criada por {version.createdBy} em {formatDateTimeBR(version.createdAt)}
        </span>
        {version.publishedAt !== undefined && (
          <span>
            publicada por {version.publishedBy} em {formatDateTimeBR(version.publishedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
