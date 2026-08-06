import { FilePlus2, FolderOpen, History, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function HomeScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Policy Matrix Studio
        </h1>
        <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
          Fonte oficial das matrizes de política de crédito — edição visual, versionamento e auditoria, num
          único arquivo.
        </p>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="gap-1 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4" /> Abrir arquivo
            </CardTitle>
            <CardDescription>Escolha um politicas.json existente.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <Button disabled className="w-full">
              Abrir
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> Recentes
            </CardTitle>
            <CardDescription>Arquivos abertos anteriormente neste navegador.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <Button disabled variant="secondary" className="w-full">
              Ver recentes
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
          <CardContent className="p-4 pt-2">
            <Button disabled variant="secondary" className="w-full">
              Novo
            </Button>
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
            <Button disabled variant="secondary" className="w-full">
              Exemplo
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <Badge variant="outline">Modo</Badge>
        <span>detecção na Sessão 05</span>
      </div>
    </div>
  );
}
