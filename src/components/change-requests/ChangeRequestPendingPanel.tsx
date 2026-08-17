import { useMemo, useState } from 'react';
import { BookOpenCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { getChangeRequestPendingSummary, type ChangeRequestPendingSummary } from '@/core/document/change-requests';
import type { ChangeRequest, PolicyOpsDocument } from '@/core/document/schema';
import { CR_STATUS_LABELS, CR_STATUS_VARIANTS } from '@/lib/change-request-labels';
import { useActor } from '@/hooks/useActor';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

const GROUPS: { key: keyof ChangeRequestPendingSummary; title: string; empty: string }[] = [
  { key: 'awaitingReview', title: 'Aguardando revisão', empty: 'Nada aguardando revisão.' },
  { key: 'returned', title: 'Devolvidos ao autor', empty: 'Nada devolvido.' },
  { key: 'approvedWithoutRelease', title: 'Aprovados sem release', empty: 'Nada aprovado sem release.' },
];

function isMine(cr: ChangeRequest, actor: string): boolean {
  return cr.requestedBy === actor || cr.owner === actor || cr.approvals.some((approval) => approval.by === actor);
}

/**
 * Painel de pendências ao abrir o documento (US-GOV-10): submetidos aguardando
 * revisão, devolvidos ao autor, aprovados sem release. Sem notificações
 * push/e-mail (sem servidor central) — este painel é o substituto (docs/14
 * §4 US-GOV-10). Papéis são declarativos (DEC-GOV-004): "meu nome" filtra por
 * quem digitou o próprio nome como solicitante, dono ou autor de uma decisão
 * — não existe cadastro de pessoas nem permissão real por trás disso.
 */
export function ChangeRequestPendingPanel({ document }: { document: PolicyOpsDocument }) {
  const setView = useUiStore((s) => s.setView);
  const setSelectedChangeRequest = useEditorStore((s) => s.setSelectedChangeRequest);
  const { actor } = useActor();
  const [onlyMine, setOnlyMine] = useState(false);

  const summary = useMemo(() => getChangeRequestPendingSummary(document), [document]);
  const total = summary.awaitingReview.length + summary.returned.length + summary.approvedWithoutRelease.length;

  function openDb(id: string) {
    setSelectedChangeRequest(id);
    setView('change-requests');
  }

  function filtered(list: ChangeRequest[]): ChangeRequest[] {
    if (!onlyMine || actor === null) return list;
    return list.filter((cr) => isMine(cr, actor));
  }

  if (total === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpenCheck className="h-4 w-4 text-neutral-400" /> Pendências do Diário de Bordo
        </CardTitle>
        {actor !== null && (
          <div className="flex items-center gap-1.5">
            <Checkbox id="pending-only-mine" checked={onlyMine} onCheckedChange={(checked) => setOnlyMine(checked === true)} />
            <Label htmlFor="pending-only-mine" className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
              Só as minhas
            </Label>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Sem servidor central, papéis são declarativos: qualquer pessoa vê e age sobre qualquer DB — este painel
          é a fila, não um controle de acesso (DEC-GOV-004).
        </p>
        {GROUPS.map(({ key, title, empty }) => {
          const list = filtered(summary[key]);
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                {title} ({list.length})
              </p>
              {list.length === 0 ? (
                <p className="text-xs text-neutral-400 dark:text-neutral-500">{empty}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {list.map((cr) => (
                    <li key={cr.id}>
                      <button
                        type="button"
                        onClick={() => openDb(cr.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-neutral-200 p-2 text-left text-xs transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-neutral-400">{cr.code}</span> {cr.title}
                        </span>
                        <Badge variant={CR_STATUS_VARIANTS[cr.status]} className="shrink-0">
                          {CR_STATUS_LABELS[cr.status]}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
