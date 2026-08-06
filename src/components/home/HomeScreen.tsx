import { useEffect, useState } from 'react';
import { FilePlus2, FolderOpen, History, Info, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePersistenceStore } from '@/store/persistence-store';
import {
  MODE_DETAIL,
  MODE_HEADLINE,
  MODE_RECOMMENDATION,
  type StorageMode,
} from '@/storage/capabilities';
import { forgetRecent, type RecentEntry } from '@/storage/recents';

/**
 * Tela inicial — docs/07-ux-e-editor.md §1: abrir, recentes (reabertos pelo
 * handle quando dá), novo, exemplo e a faixa de modo. Arrastar-e-soltar vale
 * em qualquer lugar da janela (ver `DropTarget`, no shell).
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR');
}

function ModeBanner({ mode }: { mode: StorageMode }) {
  const degraded = usePersistenceStore((s) => s.degraded);
  const capabilities = usePersistenceStore((s) => s.capabilities);

  return (
    <Card className="w-full max-w-2xl border-neutral-300 dark:border-neutral-700">
      <CardHeader className="gap-1 p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Info className="h-4 w-4" aria-hidden />
          <span data-testid="mode-headline">{MODE_HEADLINE[mode]}</span>
          <Badge variant={mode === 'FULL' ? 'default' : 'secondary'}>{mode}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 p-4 pt-0 text-xs text-neutral-600 dark:text-neutral-400">
        <p>{MODE_DETAIL[mode]}</p>
        {mode === 'DOWNLOAD_ONLY' && <p>{MODE_RECOMMENDATION}</p>}
        {degraded !== null && (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{degraded.message}</span>
          </p>
        )}
        <p className="text-neutral-400 dark:text-neutral-500">
          Origem: {capabilities.origin} · IndexedDB:{' '}
          {capabilities.indexedDB ? 'disponível' : 'indisponível'} · Compactação gzip:{' '}
          {capabilities.compressionStream ? 'disponível' : 'indisponível'}
        </p>
      </CardContent>
    </Card>
  );
}

function RecentsList() {
  const recents = usePersistenceStore((s) => s.recents);
  const openRecent = usePersistenceStore((s) => s.openRecent);

  const [entries, setEntries] = useState<RecentEntry[]>(recents);
  useEffect(() => setEntries(recents), [recents]);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Nenhum arquivo aberto ainda neste navegador.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void openRecent(entry)}
            className="flex min-w-0 flex-1 flex-col rounded-md px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className="truncate text-sm text-neutral-900 dark:text-neutral-100">
              {entry.fileName}
            </span>
            <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {entry.documentName} · rev. {entry.revision} · {formatBytes(entry.bytes)} ·{' '}
              {formatWhen(entry.openedAt)}
              {entry.hasHandle ? '' : ' · pede o arquivo de novo ao reabrir'}
            </span>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Esquecer ${entry.fileName}`}
            onClick={() => setEntries(forgetRecent(entry.id))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function HomeScreen() {
  const mode = usePersistenceStore((s) => s.mode);
  const openWithPicker = usePersistenceStore((s) => s.openWithPicker);
  const newDocument = usePersistenceStore((s) => s.newDocument);
  const openSample = usePersistenceStore((s) => s.openSample);
  const errorMessage = usePersistenceStore((s) => s.errorMessage);

  const [newName, setNewName] = useState('Políticas');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Policy Matrix Studio
        </h1>
        <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
          Fonte oficial das matrizes de política de crédito — edição visual, versionamento e
          auditoria, num único arquivo. Arraste o arquivo para qualquer lugar da janela para abrir.
        </p>
      </div>

      {errorMessage !== null && (
        <p
          role="alert"
          className="w-full max-w-2xl rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {errorMessage}
        </p>
      )}

      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="gap-1 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4" /> Abrir arquivo
            </CardTitle>
            <CardDescription>Escolha um politicas.json existente.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <Button className="w-full" onClick={() => void openWithPicker()}>
              Abrir
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FilePlus2 className="h-4 w-4" /> Novo documento
            </CardTitle>
            <CardDescription>Começa um documento em branco.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-4 pt-2">
            {/* O rótulo evita a palavra "Nome" de propósito: o diálogo de
                identidade usa exatamente esse rótulo, e dois campos com o
                mesmo nome acessível na mesma página confundem tanto o leitor
                de tela quanto quem procura o campo pelo rótulo. */}
            <Label htmlFor="new-doc-name" className="sr-only">
              Como chamar o documento
            </Label>
            <Input
              id="new-doc-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nome do documento"
            />
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => newDocument(newName)}
            >
              Novo
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> Recentes
            </CardTitle>
            <CardDescription>
              {mode === 'FULL'
                ? 'Reabre pelo handle guardado, sem novo seletor.'
                : 'Neste modo o navegador pede o arquivo de novo — o handle não pode ser guardado.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <RecentsList />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> Explorar com exemplo
            </CardTitle>
            <CardDescription>Carrega dados de exemplo em memória, sem arquivo.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => openSample()}
            >
              Exemplo
            </Button>
          </CardContent>
        </Card>
      </div>

      <ModeBanner mode={mode} />
    </div>
  );
}
