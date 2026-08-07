import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadTextFile } from '@/lib/download';
import { formatDateTimeBR } from '@/lib/format';

export interface ErrorBoundaryProps {
  /** Nome da região, usado na mensagem e no nome do arquivo de diagnóstico. */
  region: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * `ErrorBoundary` por região — docs/07-ux-e-editor.md §12: um erro de render
 * na sidebar, no canvas ou no inspector não derruba a aplicação inteira. A
 * pessoa recarrega só aquela região ou exporta um diagnóstico para o time.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
  }

  private reload = (): void => {
    this.setState({ error: null, info: null });
  };

  private exportDiagnostic = (): void => {
    const { error, info } = this.state;
    if (error === null) return;
    const lines = [
      'Relatório de diagnóstico — PolicyOps',
      `Região: ${this.props.region}`,
      `Gerado em: ${formatDateTimeBR(new Date().toISOString())}`,
      '',
      `Erro: ${error.message}`,
      '',
      'Pilha:',
      error.stack ?? '(indisponível)',
      '',
      'Pilha de componentes:',
      info?.componentStack ?? '(indisponível)',
    ];
    downloadTextFile(
      `policyops-diagnostico-${this.props.region.toLowerCase()}.txt`,
      lines.join('\n'),
      'text/plain;charset=utf-8',
    );
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <TriangleAlert className="h-8 w-8 text-red-600" aria-hidden />
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Algo deu errado em "{this.props.region}".
        </p>
        <p className="max-w-md text-xs text-neutral-500 dark:text-neutral-400">
          A aplicação encontrou um erro inesperado nesta região. Recarregar tenta restaurar essa parte da tela sem
          perder o resto do trabalho.
        </p>
        <div className="flex gap-2">
          <Button onClick={this.reload}>Recarregar esta região</Button>
          <Button variant="outline" onClick={this.exportDiagnostic}>
            Exportar diagnóstico
          </Button>
        </div>
      </div>
    );
  }
}
