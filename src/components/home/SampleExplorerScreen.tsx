import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUiStore } from '@/store/ui-store';
import { createSampleDocument } from '@/core/document/create';
import { validateDocument } from '@/core/document/validate';

/**
 * Tela provisória da Sessão 02: só prova que `createSampleDocument()` +
 * `validateDocument()` funcionam de ponta a ponta. A interface de verdade
 * (grid, inspector) chega nas sessões seguintes.
 */
export function SampleExplorerScreen() {
  const setView = useUiStore((s) => s.setView);

  const { document, issues } = useMemo(() => {
    const doc = createSampleDocument();
    const result = validateDocument(doc);
    return { document: doc, issues: result.ok ? [] : result.issues };
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setView('home')}
          aria-label="Voltar para a tela inicial"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Documento de exemplo</h1>
        <Badge variant="outline">em memória, sem arquivo</Badge>
      </div>

      {issues.length > 0 && (
        <Card className="border-red-300 dark:border-red-800">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm text-red-700 dark:text-red-400">
              {issues.length} problema(s) de validação encontrados
            </CardTitle>
          </CardHeader>
        </Card>
      )}

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
                <span className="font-normal text-neutral-400 dark:text-neutral-500">({matrix.code})</span>
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
