import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Save, SaveAll } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renameDocument } from '@/core/document/commands';
import { formatDateTimeBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { usePersistenceStore } from '@/store/persistence-store';
import { useUiStore } from '@/store/ui-store';
import { useToast } from '@/components/ui/use-toast';
import { groupBySeverity } from '@/storage/recovery';
import { useEffectiveRole } from '@/hooks/useRole';

/**
 * Tela do documento aberto. Até as telas de biblioteca e de matriz chegarem
 * (S06+), ela é o que prova o ciclo da Sessão 05 de ponta a ponta: abrir,
 * editar o nome, salvar, reabrir.
 */
export function DocumentScreen() {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setView = useUiStore((s) => s.setView);
  const save = usePersistenceStore((s) => s.save);
  const saveAs = usePersistenceStore((s) => s.saveAs);
  const closeDocument = usePersistenceStore((s) => s.closeDocument);
  const fileName = usePersistenceStore((s) => s.fileName);
  const readOnly = usePersistenceStore((s) => s.readOnly);
  const openedWithIssues = usePersistenceStore((s) => s.openedWithIssues);
  const { toast } = useToast();
  const role = useEffectiveRole();
  // READER nunca salva (docs/14 §6): a interface recusa aqui, e o servidor
  // recusa de novo em `PUT /api/document` (403) se isso for contornado.
  const roleBlocksSave = role === 'READER';
  const saveReason = roleBlocksSave ? 'Requer papel EDITOR ou superior — você é READER.' : undefined;

  const [name, setName] = useState(document?.meta.name ?? '');
  useEffect(() => setName(document?.meta.name ?? ''), [document?.meta.name]);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
        <Button onClick={() => setView('home')}>Ir para a tela inicial</Button>
      </div>
    );
  }

  function handleRename(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === document?.meta.name) return;
    const result = dispatch(renameDocument({ name: trimmed }));
    if (!result.ok) {
      toast({ title: 'Não foi possível renomear', description: result.error.message });
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            void closeDocument();
            setView('home');
          }}
          aria-label="Fechar o documento e voltar para a tela inicial"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {document.meta.name}
        </h1>
        {fileName === null ? (
          <Badge variant="outline">em memória, sem arquivo</Badge>
        ) : (
          <Badge variant="secondary">{fileName}</Badge>
        )}
        {readOnly && <Badge variant="outline">somente leitura</Badge>}
        {roleBlocksSave && <Badge variant="outline">papel READER — só consulta</Badge>}
      </div>

      {openedWithIssues !== null && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm text-amber-700 dark:text-amber-400">
              Aberto com {openedWithIssues.issues.length} problema(s) de validação
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-4 pt-0 text-xs text-neutral-600 dark:text-neutral-400">
            <p>
              O arquivo não passou na validação e foi aberto assim mesmo, em somente leitura. Nada foi
              gravado. Para editar e salvar, corrija os problemas abaixo no arquivo original e abra de
              novo.
            </p>
            {groupBySeverity(openedWithIssues.issues).map((group) => (
              <div key={group.severity} className="flex flex-col gap-1">
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {group.label}
                </span>
                <ul className="flex flex-col gap-1">
                  {group.issues.map((issue, index) => (
                    <li key={`${issue.invariant}-${issue.path}-${index}`}>
                      <span className="font-mono">[{issue.invariant}]</span> {issue.message}{' '}
                      <span className="font-mono text-neutral-400 dark:text-neutral-500">
                        ({issue.path})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Documento</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-0">
          <form onSubmit={handleRename} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="document-name">Nome do documento</Label>
              <Input
                id="document-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary">
              Renomear
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span>revisão {document.meta.revision}</span>
            <span aria-hidden>·</span>
            <span>
              {document.meta.savedAt === null
                ? 'nunca salvo'
                : `salvo em ${formatDateTimeBR(document.meta.savedAt)} por ${document.meta.savedBy ?? '—'}`}
            </span>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={readOnly || roleBlocksSave} title={saveReason}>
              <Save className="mr-2 h-4 w-4" /> Salvar
            </Button>
            <Button variant="secondary" onClick={() => void saveAs()}>
              <SaveAll className="mr-2 h-4 w-4" /> Salvar como
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Variáveis" value={document.variables.length} />
        <SummaryTile label="Regras de compatibilidade" value={document.compatibility.length} />
        <SummaryTile label="Projetos" value={document.projects.length} />
        <SummaryTile label="Matrizes" value={document.matrices.length} />
      </div>

      <div className="flex flex-col gap-3">
        {document.matrices.map((matrix) => (
          <Card key={matrix.id}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">
                {matrix.name}{' '}
                <span className="font-normal text-neutral-400 dark:text-neutral-500">
                  ({matrix.code})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 p-4 pt-0 text-sm text-neutral-600 dark:text-neutral-400">
              <div>{matrix.versions.length} versão(ões)</div>
              {matrix.versions.map((version) => (
                <div key={version.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    v{version.number} · {version.state}
                  </Badge>
                  <span>
                    {version.axes.x.tuples.length} × {version.axes.y.tuples.length} ={' '}
                    {version.axes.x.tuples.length * version.axes.y.tuples.length} combinações
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
      </CardContent>
    </Card>
  );
}
