import { useMemo, useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CreateReleaseDialog } from '@/components/change-requests/CreateReleaseDialog';
import { ReleaseDetail } from '@/components/change-requests/ReleaseDetail';
import { deriveReleaseJointStatus, listReleaseChangeRequests } from '@/core/document/releases';
import { formatDateBR } from '@/lib/format';
import { RELEASE_JOINT_STATUS_LABELS, RELEASE_JOINT_STATUS_VARIANTS } from '@/lib/release-labels';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/** Lista de releases (docs/07 §19.6, docs/14 §3.4) — CRUD, conteúdo e publicação em `ReleaseDetail`. */
export function ReleasesScreen() {
  const document = useDocumentStore((s) => s.document);
  const selectedReleaseId = useEditorStore((s) => s.selectedReleaseId);
  const setSelectedRelease = useEditorStore((s) => s.setSelectedRelease);

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const releases = useMemo(() => {
    if (document === null) return [];
    const searchLower = search.trim().toLowerCase();
    return [...document.releases]
      .filter(
        (release) =>
          searchLower === '' ||
          `${release.code} ${release.name ?? ''}`.toLowerCase().includes(searchLower),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [document, search]);

  if (document === null) return null;

  if (selectedReleaseId !== null) {
    return <ReleaseDetail releaseId={selectedReleaseId} />;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-neutral-400" />
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Releases</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova release
        </Button>
      </div>

      <Input
        placeholder="Buscar por código ou nome…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {releases.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Package className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {search.trim() !== '' ? 'Nenhuma release corresponde ao filtro.' : 'Nenhuma release ainda neste documento.'}
            </p>
            {search.trim() === '' && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Nova release
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2" data-testid="release-list">
          {releases.map((release) => {
            const crs = listReleaseChangeRequests(document, release.id);
            const jointStatus = deriveReleaseJointStatus(document, release.id, { at: new Date() });
            return (
              <button
                key={release.id}
                type="button"
                data-testid={`release-row-${release.code}`}
                onClick={() => setSelectedRelease(release.id)}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {release.name ?? release.code}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-neutral-400">{release.code}</span>
                  </div>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {crs.length > 0 ? crs.map((cr) => cr.code).join(', ') : 'sem DB vinculado'}
                    {release.plannedDate !== undefined ? ` · planejada para ${formatDateBR(release.plannedDate)}` : ''}
                  </p>
                </div>
                <Badge variant={RELEASE_JOINT_STATUS_VARIANTS[jointStatus]}>
                  {RELEASE_JOINT_STATUS_LABELS[jointStatus]}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      <CreateReleaseDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setSelectedRelease(id)} />
    </div>
  );
}
