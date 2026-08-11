import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/core/error-messages';
import { applyImport } from '@/core/import/apply';
import type { ImportTable } from '@/core/import/parse-table';
import { planImport } from '@/core/import/plan';
import { saveImportProfile } from '@/core/import/profile-commands';
import type { DocumentWithProfiles } from '@/core/import/profile';
import { MIN_NOTES_LENGTH } from '@/core/versioning/lifecycle';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { useUiStore } from '@/store/ui-store';
import { isApplicable } from './plan-preview';

/**
 * Passo 6 — aplicar. docs/12-carga-de-matrizes.md US-06, US-07, US-08, §6.1.
 *
 * O passo diz em números o que vai acontecer, aplica, e abre a fila de
 * revisão. **Nada é publicado aqui, em nenhum caminho** (RN-10).
 */
export function Step6Apply({ table }: { table: ImportTable }) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setView = useUiStore((s) => s.setView);
  const setImportRunFilter = useUiStore((s) => s.setImportRunFilter);
  const { toast } = useToast();

  const profile = useImportStore((s) => s.profile);
  const fileName = useImportStore((s) => s.fileName);
  const storedSelection = useImportStore((s) => s.selectedKeys);
  const recognizedProfile = useImportStore((s) => s.recognizedProfile);
  const notes = useImportStore((s) => s.notes);
  const setNotes = useImportStore((s) => s.setNotes);
  const report = useImportStore((s) => s.report);
  const setReport = useImportStore((s) => s.setReport);
  const setProfileIdentity = useImportStore((s) => s.setProfileIdentity);
  const reset = useImportStore((s) => s.reset);

  const [profileCode, setProfileCode] = useState(
    recognizedProfile?.code ?? (profile.code === 'CARGA_EM_ANDAMENTO' ? '' : profile.code),
  );
  const [profileName, setProfileName] = useState(
    recognizedProfile?.name ?? (profile.name === 'Carga em andamento' ? '' : profile.name),
  );
  const [profileSaved, setProfileSaved] = useState(false);

  const plan = useMemo(() => {
    if (document === null) return undefined;
    return planImport(document as DocumentWithProfiles, table, profile, { fileName });
  }, [document, table, profile, fileName]);

  const selectedKeys = useMemo(() => {
    if (plan === undefined) return [];
    const applicable = plan.matrices.filter(isApplicable).map((entry) => entry.key);
    if (storedSelection === undefined) return applicable;
    const chosen = new Set(storedSelection);
    return applicable.filter((key) => chosen.has(key));
  }, [plan, storedSelection]);

  if (document === null || plan === undefined) return null;

  const selected = new Set(selectedKeys);
  const novas = plan.matrices.filter((e) => e.status === 'NEW' && selected.has(e.key));
  const alteradas = plan.matrices.filter((e) => e.status === 'CHANGED' && selected.has(e.key));
  const celulas = [...novas, ...alteradas].reduce((total, e) => total + e.changes.length, 0);
  const notesOk = notes.trim().length >= MIN_NOTES_LENGTH;
  const canApply = selectedKeys.length > 0 && notesOk;

  function handleApply() {
    if (plan === undefined) return;
    const result = dispatch(
      applyImport({
        profile,
        table,
        ...(fileName === undefined ? {} : { fileName }),
        planHash: plan.planHash,
        selectedKeys,
        notes,
      }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'A carga não foi aplicada',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    setReport(result.data);
    toast({
      title: 'Carga aplicada',
      description: `${result.data.createdMatrices.length} matrizes criadas e ${result.data.createdDrafts.length} rascunhos a revisar. Nada foi publicado.`,
    });
  }

  function handleSaveProfile() {
    const code = profileCode.trim().toUpperCase();
    const name = profileName.trim();
    if (code === '' || name === '') return;
    const now = new Date().toISOString();
    const result = dispatch(
      saveImportProfile({
        profile: {
          ...profile,
          ...(recognizedProfile === undefined
            ? {}
            : { id: recognizedProfile.id, createdAt: recognizedProfile.createdAt }),
          code,
          name,
          createdAt: profile.createdAt === '1970-01-01T00:00:00.000Z' ? now : profile.createdAt,
        },
      }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'O perfil não foi salvo',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    setProfileIdentity(code, name);
    setProfileSaved(true);
    toast({
      title: result.data.created ? 'Perfil salvo' : 'Perfil atualizado',
      description: `A próxima carga com este cabeçalho reconhece "${code}" sozinha.`,
    });
  }

  // -------------------------------------------------------------------------
  // Relatório, depois de aplicar
  // -------------------------------------------------------------------------

  if (report !== undefined) {
    return (
      <div className="flex flex-col gap-4" data-testid="import-report">
        <Card className="border-green-300 dark:border-green-900">
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                Carga aplicada. Nada foi publicado.
              </p>
            </div>
            <ul className="flex flex-col gap-1 text-sm text-neutral-700 dark:text-neutral-300">
              <li>{report.createdMatrices.length} matrizes criadas</li>
              <li>{report.createdDrafts.length} rascunhos a revisar</li>
              {report.ignoredByUser.length > 0 && (
                <li>{report.ignoredByUser.length} matrizes deixadas de fora por escolha sua</li>
              )}
            </ul>
            <Button
              type="button"
              className="self-start"
              data-testid="open-review-queue"
              onClick={() => {
                setImportRunFilter(report.importRunId);
                reset();
                setView('drafts');
              }}
            >
              Abrir a fila de revisão
            </Button>
          </CardContent>
        </Card>

        <ProfileCard
          code={profileCode}
          name={profileName}
          saved={profileSaved}
          recognized={recognizedProfile !== undefined}
          onCode={setProfileCode}
          onName={setProfileName}
          onSave={handleSaveProfile}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Antes de aplicar
  // -------------------------------------------------------------------------

  const resumo = [
    novas.length > 0 ? `cria ${novas.length} ${novas.length === 1 ? 'matriz' : 'matrizes'}` : null,
    alteradas.length > 0
      ? `cria ${alteradas.length} ${alteradas.length === 1 ? 'rascunho' : 'rascunhos'}`
      : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-notes">Nota da carga</Label>
        <Textarea
          id="import-notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={`Ex.: Carga ${fileName ?? 'do arquivo'} — mínimo de ${MIN_NOTES_LENGTH} caracteres`}
        />
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          É a nota padrão de cada publicação desta carga — mínimo de {MIN_NOTES_LENGTH} caracteres.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <p className="text-sm text-neutral-900 dark:text-neutral-100" data-testid="apply-summary">
            {resumo.length === 0
              ? 'Nenhuma alteração a aplicar.'
              : `${resumo.join('; ')}. Não publica nada.`}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {celulas} células no total · {plan.totals.unchanged} matrizes inalteradas continuam
            intocadas.
          </p>
          <Button
            type="button"
            className="self-start"
            disabled={!canApply}
            data-testid="apply-import"
            onClick={handleApply}
          >
            Aplicar a carga
          </Button>
          {selectedKeys.length === 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Nenhuma alteração a aplicar — volte ao plano e selecione ao menos uma matriz nova ou
              alterada.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileCard({
  code,
  name,
  saved,
  recognized,
  onCode,
  onName,
  onSave,
}: {
  code: string;
  name: string;
  saved: boolean;
  recognized: boolean;
  onCode: (value: string) => void;
  onName: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {recognized ? 'Atualizar o perfil reconhecido' : 'Salvar como perfil'}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            O perfil viaja dentro do documento: a próxima carga com este cabeçalho é reconhecida
            sozinha e vai direto ao plano.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-code">Código</Label>
            <Input
              id="profile-code"
              value={code}
              onChange={(event) => onCode(event.target.value.toUpperCase())}
              placeholder="CARGA_CINEMINHA"
              className="w-56 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-name">Nome</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => onName(event.target.value)}
              placeholder="Carga do cineminha"
              className="w-64"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={code.trim() === '' || name.trim() === ''}
            data-testid="save-profile"
            onClick={onSave}
          >
            {recognized ? 'Atualizar perfil' : 'Salvar perfil'}
          </Button>
          {saved && (
            <span className="text-xs text-green-700 dark:text-green-400">Perfil gravado.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
