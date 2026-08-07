import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Archive, FilePlus, Info, Save, Send, Trash2 } from 'lucide-react';
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
import type { Domain, RegionalDimension, VariableVersion } from '@/core/document/schema';
import { validateDomains } from '@/core/library/validate-domains';
import {
  archiveVariable,
  createVariableDraft,
  discardVariableDraft,
  publishVariable,
  saveVariableDomains,
  updateVariableMeta,
} from '@/core/library/variables';
import { getVariableUsage } from '@/core/queries';
import { getDraftsAdoptingVariable } from '@/core/reconcile/stale';
import { formatDateTimeBR } from '@/lib/format';
import { VARIABLE_TYPE_LABELS } from '@/lib/variable-types';
import { useDocumentStore } from '@/store/document-store';
import { AdoptionList } from './AdoptionList';
import { ConfirmDialog } from './ConfirmDialog';
import { DomainsEditor } from './DomainsEditor';

type VariableVersionState = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';

const STATE_LABEL: Record<VariableVersionState, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Vigente',
  SUPERSEDED: 'Histórico',
};

const STATE_BADGE: Record<VariableVersionState, BadgeVariant> = {
  DRAFT: 'amber',
  PUBLISHED: 'green',
  SUPERSEDED: 'secondary',
};

function pickDefaultVersion(versions: VariableVersion[]): VariableVersion | null {
  if (versions.length === 0) return null;
  const draft = versions.find((v) => v.state === 'DRAFT');
  if (draft !== undefined) return draft;
  const published = versions.find((v) => v.state === 'PUBLISHED');
  if (published !== undefined) return published;
  return [...versions].sort((a, b) => b.number - a.number)[0]!;
}

function domainsEqual(a: Domain[], b: Domain[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function regionalDimensionEqual(a: RegionalDimension | undefined, b: RegionalDimension | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export interface VariableDetailProps {
  variableId: string;
  onBack: () => void;
}

export function VariableDetail({ variableId, onBack }: VariableDetailProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const variable = document?.variables.find((v) => v.id === variableId) ?? null;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    () => pickDefaultVersion(variable?.versions ?? [])?.id ?? null,
  );
  useEffect(() => {
    setSelectedVersionId(pickDefaultVersion(variable?.versions ?? [])?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variableId]);

  const selectedVersion = variable?.versions.find((v) => v.id === selectedVersionId) ?? null;

  const [editingDomains, setEditingDomains] = useState<Domain[]>(selectedVersion?.domains ?? []);
  const [editingRegionalDimension, setEditingRegionalDimension] = useState<RegionalDimension | undefined>(
    selectedVersion?.regionalDimension,
  );
  useEffect(() => {
    setEditingDomains(selectedVersion?.domains ?? []);
    setEditingRegionalDimension(selectedVersion?.regionalDimension);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersionId]);

  const [name, setName] = useState(variable?.name ?? '');
  const [description, setDescription] = useState(variable?.description ?? '');
  useEffect(() => {
    setName(variable?.name ?? '');
    setDescription(variable?.description ?? '');
  }, [variable?.name, variable?.description]);

  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishNotes, setPublishNotes] = useState('');
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const validation = useMemo(() => {
    if (variable === null) return { ok: true as const };
    return validateDomains(variable.type, editingDomains, editingRegionalDimension);
  }, [variable, editingDomains, editingRegionalDimension]);
  const issues = validation.ok ? [] : validation.issues;

  const usage = useMemo(() => (document === null ? [] : getVariableUsage(document, variableId)), [
    document,
    variableId,
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
    () => (document === null ? [] : getDraftsAdoptingVariable(document, variableId)),
    [document, variableId],
  );

  if (document === null || variable === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Variável não encontrada.</p>
        <Button onClick={onBack}>Voltar à lista</Button>
      </div>
    );
  }

  const isDraft = selectedVersion?.state === 'DRAFT';
  const dirty =
    selectedVersion !== null &&
    (!domainsEqual(editingDomains, selectedVersion.domains) ||
      !regionalDimensionEqual(editingRegionalDimension, selectedVersion.regionalDimension));
  const hasOpenDraft = variable.versions.some((v) => v.state === 'DRAFT');
  const hasPublished = variable.versions.some((v) => v.state === 'PUBLISHED');

  function handleSaveMeta() {
    const result = dispatch(
      updateVariableMeta({
        variableId,
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
      }),
    );
    if (!result.ok) toast({ title: 'Não foi possível salvar', description: result.error.message });
    else toast({ title: 'Metadados salvos' });
  }

  function handleCreateDraft() {
    const result = dispatch(createVariableDraft({ variableId }));
    if (!result.ok) {
      toast({ title: 'Não foi possível criar o rascunho', description: result.error.message });
      return;
    }
    setSelectedVersionId(result.data.versionId);
  }

  function handleSaveDomains() {
    if (selectedVersion === null) return;
    const result = dispatch(
      saveVariableDomains({
        variableId,
        versionId: selectedVersion.id,
        domains: editingDomains,
        ...(editingRegionalDimension === undefined ? {} : { regionalDimension: editingRegionalDimension }),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar os domínios', description: result.error.message });
      return;
    }
    toast({ title: 'Domínios salvos' });
  }

  function handlePublish() {
    if (selectedVersion === null) return;
    const result = dispatch(
      publishVariable({
        variableId,
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
    const result = dispatch(discardVariableDraft({ variableId, versionId: selectedVersion.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível descartar', description: result.error.message });
      return;
    }
    toast({ title: 'Rascunho descartado' });
    const updated = useDocumentStore.getState().document?.variables.find((v) => v.id === variableId);
    setSelectedVersionId(pickDefaultVersion(updated?.versions ?? [])?.id ?? null);
  }

  function handleArchive() {
    const result = dispatch(archiveVariable({ variableId }));
    if (!result.ok) {
      toast({ title: 'Não foi possível arquivar', description: result.error.message });
      return;
    }
    toast({ title: 'Variável arquivada' });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Voltar à lista de variáveis">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {variable.name}
          </h1>
          <span className="shrink-0 font-mono text-xs text-neutral-400">{variable.code}</span>
          <Badge variant="secondary">{VARIABLE_TYPE_LABELS[variable.type]}</Badge>
          {variable.archivedAt !== undefined && <Badge variant="outline">arquivada</Badge>}
        </div>
        {variable.archivedAt === undefined && (
          <Button variant="outline" size="sm" onClick={() => setArchiveDialogOpen(true)}>
            <Archive className="mr-1.5 h-4 w-4" /> Arquivar
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Metadados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-0">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="variable-name">Nome</Label>
            <Input id="variable-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="variable-description">Descrição</Label>
            <Input
              id="variable-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <Button size="sm" variant="secondary" className="self-start" onClick={handleSaveMeta}>
            Salvar metadados
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Versões</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-4 pt-0">
            {[...variable.versions]
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
                  Domínios da versão {selectedVersion?.number}{' '}
                  {!isDraft && <span className="font-normal text-neutral-400">(somente leitura)</span>}
                </span>
                <span className="text-xs font-normal text-neutral-400">
                  {editingDomains.length} domínio(s)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {selectedVersion !== null && (
                <DomainsEditor
                  key={selectedVersion.id}
                  type={variable.type}
                  domains={editingDomains}
                  onChange={setEditingDomains}
                  issues={issues}
                  disabled={!isDraft}
                  regionalDimension={editingRegionalDimension}
                  onRegionalDimensionChange={setEditingRegionalDimension}
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
                    <Button size="sm" variant="secondary" disabled={!dirty} onClick={handleSaveDomains}>
                      <Save className="mr-1.5 h-4 w-4" /> Salvar
                    </Button>
                    <Button
                      size="sm"
                      disabled={dirty || issues.length > 0 || editingDomains.length === 0}
                      onClick={() => setPublishDialogOpen(true)}
                    >
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
                  Nenhuma matriz usa esta variável ainda.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {usageByMatrix.map(({ matrixCode, entries }) => (
                    <li key={matrixCode} className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">{matrixCode}</span>
                      {entries.map((entry, index) => (
                        <Badge key={index} variant={STATE_BADGE[entry.versionState as VariableVersionState] ?? 'secondary'}>
                          v{entry.versionNumber} · {STATE_LABEL[entry.versionState as VariableVersionState] ?? entry.versionState}
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
                  emptyText="Nenhum rascunho tem a adotar: todos já estão na versão publicada desta variável."
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
            <Label htmlFor="publish-notes">Notas (opcional)</Label>
            <Input
              id="publish-notes"
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
        title={`Arquivar "${variable.name}"?`}
        description="A variável some das opções de novas matrizes. Falha se ela estiver em uso por uma versão publicada."
        confirmLabel="Arquivar"
        destructive
        onConfirm={handleArchive}
      />
    </div>
  );
}
