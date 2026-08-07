import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Archive, FilePlus, Info, Save, Send, Trash2 } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import type { CompatibilityVersion, DefaultForUnlisted, Domain } from '@/core/document/schema';
import {
  archiveCompatibility,
  createCompatibilityDraft,
  discardCompatibilityDraft,
  publishCompatibility,
  saveCompatibilityMap,
} from '@/core/library/compatibility';
import { getCompatibilityUsage } from '@/core/queries';
import { getDraftsAdoptingRule } from '@/core/reconcile/stale';
import { formatDateTimeBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { AdoptionList } from './AdoptionList';
import { ConfirmDialog } from './ConfirmDialog';
import { CompatibilityMapEditor } from './CompatibilityMapEditor';

type CompatibilityVersionState = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';

const STATE_LABEL: Record<CompatibilityVersionState, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Vigente',
  SUPERSEDED: 'Histórico',
};

const STATE_BADGE: Record<CompatibilityVersionState, BadgeVariant> = {
  DRAFT: 'amber',
  PUBLISHED: 'green',
  SUPERSEDED: 'secondary',
};


function pickDefaultVersion(versions: CompatibilityVersion[]): CompatibilityVersion | null {
  if (versions.length === 0) return null;
  const draft = versions.find((v) => v.state === 'DRAFT');
  if (draft !== undefined) return draft;
  const published = versions.find((v) => v.state === 'PUBLISHED');
  if (published !== undefined) return published;
  return [...versions].sort((a, b) => b.number - a.number)[0]!;
}

function mapEqual(
  a: { allow: Record<string, string[]>; defaultForUnlisted: DefaultForUnlisted },
  b: { allow: Record<string, string[]>; defaultForUnlisted: DefaultForUnlisted },
): boolean {
  return a.defaultForUnlisted === b.defaultForUnlisted && JSON.stringify(a.allow) === JSON.stringify(b.allow);
}

export interface CompatibilityDetailProps {
  ruleId: string;
  onBack: () => void;
}

export function CompatibilityDetail({ ruleId, onBack }: CompatibilityDetailProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const rule = document?.compatibility.find((r) => r.id === ruleId) ?? null;
  const parentVariable = document?.variables.find((v) => v.id === rule?.parentVariableId) ?? null;
  const childVariable = document?.variables.find((v) => v.id === rule?.childVariableId) ?? null;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    () => pickDefaultVersion(rule?.versions ?? [])?.id ?? null,
  );
  useEffect(() => {
    setSelectedVersionId(pickDefaultVersion(rule?.versions ?? [])?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleId]);

  const selectedVersion = rule?.versions.find((v) => v.id === selectedVersionId) ?? null;

  const [editingAllow, setEditingAllow] = useState<Record<string, string[]>>(selectedVersion?.allow ?? {});
  const [editingDefault, setEditingDefault] = useState<DefaultForUnlisted>(
    selectedVersion?.defaultForUnlisted ?? 'ALL',
  );
  useEffect(() => {
    setEditingAllow(selectedVersion?.allow ?? {});
    setEditingDefault(selectedVersion?.defaultForUnlisted ?? 'ALL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersionId]);

  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishNotes, setPublishNotes] = useState('');
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const parentDomains: Domain[] = useMemo(() => {
    if (selectedVersion === null || parentVariable === null) return [];
    return (
      parentVariable.versions.find((v) => v.id === selectedVersion.parentVariableVersionId)?.domains ?? []
    );
  }, [selectedVersion, parentVariable]);
  const childDomains: Domain[] = useMemo(() => {
    if (selectedVersion === null || childVariable === null) return [];
    return childVariable.versions.find((v) => v.id === selectedVersion.childVariableVersionId)?.domains ?? [];
  }, [selectedVersion, childVariable]);

  const usage = useMemo(() => (document === null ? [] : getCompatibilityUsage(document, ruleId)), [
    document,
    ruleId,
  ]);
  const usageByMatrix = useMemo(() => {
    const groups = new Map<string, { matrixCode: string; entries: typeof usage }>();
    for (const entry of usage) {
      const group = groups.get(entry.matrixId);
      if (group === undefined) groups.set(entry.matrixId, { matrixCode: entry.matrixCode, entries: [entry] });
      else group.entries.push(entry);
    }
    return [...groups.values()];
  }, [usage]);

  const adoptable = useMemo(
    () => (document === null ? [] : getDraftsAdoptingRule(document, ruleId)),
    [document, ruleId],
  );

  if (document === null || rule === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Regra de compatibilidade não encontrada.</p>
        <Button onClick={onBack}>Voltar à lista</Button>
      </div>
    );
  }

  const isDraft = selectedVersion?.state === 'DRAFT';
  const dirty =
    selectedVersion !== null &&
    !mapEqual(
      { allow: editingAllow, defaultForUnlisted: editingDefault },
      { allow: selectedVersion.allow, defaultForUnlisted: selectedVersion.defaultForUnlisted },
    );
  const hasOpenDraft = rule.versions.some((v) => v.state === 'DRAFT');
  const hasPublished = rule.versions.some((v) => v.state === 'PUBLISHED');

  function handleCreateDraft() {
    const result = dispatch(createCompatibilityDraft({ ruleId }));
    if (!result.ok) {
      toast({ title: 'Não foi possível criar o rascunho', description: result.error.message });
      return;
    }
    setSelectedVersionId(result.data.versionId);
  }

  function handleSaveMap() {
    if (selectedVersion === null) return;
    const result = dispatch(
      saveCompatibilityMap({
        ruleId,
        versionId: selectedVersion.id,
        allow: editingAllow,
        defaultForUnlisted: editingDefault,
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar o mapa', description: result.error.message });
      return;
    }
    toast({ title: 'Mapa salvo' });
  }

  function handlePublish() {
    if (selectedVersion === null) return;
    const result = dispatch(
      publishCompatibility({
        ruleId,
        versionId: selectedVersion.id,
        ...(publishNotes.trim() !== '' ? { notes: publishNotes.trim() } : {}),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível publicar', description: result.error.message });
      return;
    }
    setPublishNotes('');
    toast({ title: `Versão ${selectedVersion.number} publicada` });
    setSelectedVersionId(result.data.versionId);
  }

  function handleDiscard() {
    if (selectedVersion === null) return;
    const result = dispatch(discardCompatibilityDraft({ ruleId, versionId: selectedVersion.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível descartar', description: result.error.message });
      return;
    }
    toast({ title: 'Rascunho descartado' });
    const updated = useDocumentStore.getState().document?.compatibility.find((r) => r.id === ruleId);
    setSelectedVersionId(pickDefaultVersion(updated?.versions ?? [])?.id ?? null);
  }

  function handleArchive() {
    const result = dispatch(archiveCompatibility({ ruleId }));
    if (!result.ok) {
      toast({ title: 'Não foi possível arquivar', description: result.error.message });
      return;
    }
    toast({ title: 'Regra arquivada' });
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Voltar à lista de compatibilidade">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">{rule.name}</h1>
          <span className="shrink-0 font-mono text-xs text-neutral-400">{rule.code}</span>
          {rule.archivedAt !== undefined && <Badge variant="outline">arquivada</Badge>}
        </div>
        {rule.archivedAt === undefined && (
          <Button variant="outline" size="sm" onClick={() => setArchiveDialogOpen(true)}>
            <Archive className="mr-1.5 h-4 w-4" /> Arquivar
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-neutral-700 dark:text-neutral-300">
          <span className="font-medium">{parentVariable?.name ?? '?'}</span>
          <ArrowRight className="h-4 w-4 text-neutral-400" aria-hidden />
          <span className="font-medium">{childVariable?.name ?? '?'}</span>
          {rule.description !== undefined && (
            <span className="ml-2 text-neutral-500 dark:text-neutral-400">— {rule.description}</span>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Versões</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-4 pt-0">
            {[...rule.versions]
              .sort((a, b) => b.number - a.number)
              .map((version) => (
                <button
                  key={version.id}
                  type="button"
                  onClick={() => setSelectedVersionId(version.id)}
                  className={`flex flex-col gap-0.5 rounded-md border p-2 text-left text-xs transition-colors ${
                    version.id === selectedVersionId
                      ? 'border-neutral-400 bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800'
                      : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/60'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">v{version.number}</span>
                    <Badge variant={STATE_BADGE[version.state]} className="px-1.5 py-0 text-[10px]">
                      {STATE_LABEL[version.state]}
                    </Badge>
                  </div>
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {formatDateTimeBR(version.publishedAt ?? version.createdAt)}
                  </span>
                  {version.notes !== undefined && (
                    <span className="text-neutral-500 dark:text-neutral-400">{version.notes}</span>
                  )}
                </button>
              ))}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>
                  Mapa da versão {selectedVersion?.number}{' '}
                  {!isDraft && <span className="font-normal text-neutral-400">(somente leitura)</span>}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {selectedVersion !== null && rule !== null && (
                <CompatibilityMapEditor
                  key={selectedVersion.id}
                  ruleId={rule.id}
                  ruleCode={rule.code}
                  parentVariableId={rule.parentVariableId}
                  childVariableId={rule.childVariableId}
                  compatibilityVersionId={selectedVersion.id}
                  parentLabel={parentVariable?.name ?? 'Pai'}
                  childLabel={childVariable?.name ?? 'Filho'}
                  parentDomains={parentDomains}
                  childDomains={childDomains}
                  allow={editingAllow}
                  defaultForUnlisted={editingDefault}
                  onChange={({ allow, defaultForUnlisted }) => {
                    setEditingAllow(allow);
                    setEditingDefault(defaultForUnlisted);
                  }}
                  disabled={!isDraft}
                />
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {!hasOpenDraft && hasPublished && (
                  <Button size="sm" onClick={handleCreateDraft}>
                    <FilePlus className="mr-1.5 h-4 w-4" /> Criar rascunho
                  </Button>
                )}
                {isDraft && (
                  <>
                    <Button size="sm" variant="secondary" disabled={!dirty} onClick={handleSaveMap}>
                      <Save className="mr-1.5 h-4 w-4" /> Salvar
                    </Button>
                    <Button size="sm" disabled={dirty} onClick={() => setPublishDialogOpen(true)}>
                      <Send className="mr-1.5 h-4 w-4" /> Publicar
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setDiscardDialogOpen(true)}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Descartar
                    </Button>
                  </>
                )}
              </div>
              {isDraft && dirty && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Há mudanças não salvas — salve antes de publicar.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Impacto</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 p-4 pt-0">
              <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>
                  Publicar esta versão <strong>não altera</strong> nenhuma matriz já publicada. Rascunhos
                  poderão adotar a nova versão manualmente.
                </p>
              </div>

              {usageByMatrix.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Nenhuma matriz derivou tuplas desta regra ainda.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {usageByMatrix.map(({ matrixCode, entries }) => (
                    <li key={matrixCode} className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">{matrixCode}</span>
                      {entries.map((entry, index) => (
                        <Badge key={index} variant="secondary">
                          eixo {entry.role} · v{entry.versionNumber} · regra v
                          {entry.compatibilityVersionNumber ?? '?'}
                        </Badge>
                      ))}
                    </li>
                  ))}
                </ul>
              )}

              {/* Além do uso, quem **pode adotar** — docs/prompts/S16, item 4. */}
              <div className="flex flex-col gap-1.5 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Rascunhos que podem adotar a versão mais recente
                </span>
                <AdoptionList
                  entries={adoptable}
                  emptyText="Nenhum rascunho tem a adotar: todos já derivam suas tuplas da versão publicada desta regra."
                />
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  A adoção é sempre matriz a matriz: cada grid cria e destrói combinações de um jeito
                  diferente, e quem decide o que fazer com as células novas é você.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar versão {selectedVersion?.number}</DialogTitle>
            <DialogDescription>
              A versão vigente atual (se houver) vira histórico. Matrizes publicadas continuam intocadas.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compat-publish-notes">Notas (opcional)</Label>
            <Input
              id="compat-publish-notes"
              value={publishNotes}
              onChange={(event) => setPublishNotes(event.target.value)}
              placeholder="O que mudou nesta versão?"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setPublishDialogOpen(false);
                handlePublish();
              }}
            >
              Publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        title={`Descartar a versão ${selectedVersion?.number}?`}
        description="O rascunho é removido e o número da versão não fica reservado. Esta ação não pode ser desfeita pelo Ctrl+Z."
        confirmLabel="Descartar rascunho"
        destructive
        onConfirm={handleDiscard}
      />

      <ConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        title={`Arquivar "${rule.name}"?`}
        description="A regra some das opções para novos eixos. Versões de matriz já publicadas não são afetadas."
        confirmLabel="Arquivar"
        destructive
        onConfirm={handleArchive}
      />
    </div>
  );
}
