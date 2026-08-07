import { useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Shell } from '@/components/shell/Shell';
import { UnderConstruction } from '@/components/shell/UnderConstruction';
import { DropTarget } from '@/components/shell/DropTarget';
import { HomeScreen } from '@/components/home/HomeScreen';
import { DocumentScreen } from '@/components/document/DocumentScreen';
import { VariablesScreen } from '@/components/library/VariablesScreen';
import { CompatibilityScreen } from '@/components/library/CompatibilityScreen';
import { CatalogScreen } from '@/components/library/CatalogScreen';
import { ProjectsScreen } from '@/components/projects/ProjectsScreen';
import { MatrixScreen } from '@/components/matrix/MatrixScreen';
import { CompareScreen } from '@/components/compare/CompareScreen';
import { DraftsScreen } from '@/components/drafts/DraftsScreen';
import { TimelineScreen } from '@/components/timeline/TimelineScreen';
import { TemplatesScreen } from '@/components/templates/TemplatesScreen';
import { IdentityDialog } from '@/components/dialogs/IdentityDialog';
import { ConflictDialog } from '@/components/dialogs/ConflictDialog';
import { MergeDialog } from '@/components/dialogs/MergeDialog';
import { RecoveryDialog } from '@/components/dialogs/RecoveryDialog';
import { InvalidDocumentDialog } from '@/components/dialogs/InvalidDocumentDialog';
import { BufferRecoveryDialog } from '@/components/dialogs/BufferRecoveryDialog';
import { CompressionOfferDialog } from '@/components/dialogs/CompressionOfferDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useHashRouting } from '@/hooks/useHashRouting';
import { usePersistence } from '@/hooks/usePersistence';
import { useDocumentStore } from '@/store/document-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Rota e documento andam juntos, nos dois sentidos:
 *
 * - abrir um documento (pelo seletor, arrastando, pelos recentes, do exemplo
 *   ou em branco) leva à tela do documento — venha de onde vier, sem cada
 *   botão ter de lembrar de navegar;
 * - estar na tela do documento sem documento aberto volta para a tela
 *   inicial. É o que acontece ao recarregar a página com `#/documento` no
 *   endereço: o documento vive em memória e não sobrevive ao F5.
 */
function useDocumentRoute(): void {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const hasDocument = useDocumentStore((s) => s.document !== null);

  useEffect(() => {
    if (view === 'document' && !hasDocument) setView('home');
    else if (view === 'home' && hasDocument) setView('document');
  }, [view, hasDocument, setView]);
}

function CurrentView() {
  const view = useUiStore((s) => s.view);
  if (view === 'home') return <HomeScreen />;
  if (view === 'document') return <DocumentScreen />;
  if (view === 'library-variables') return <VariablesScreen />;
  if (view === 'library-compatibility') return <CompatibilityScreen />;
  if (view === 'library-content') return <CatalogScreen />;
  if (view === 'projects') return <ProjectsScreen />;
  if (view === 'matrix') return <MatrixScreen />;
  if (view === 'drafts') return <DraftsScreen />;
  if (view === 'compare') return <CompareScreen />;
  if (view === 'timeline') return <TimelineScreen />;
  if (view === 'templates') return <TemplatesScreen />;
  return <UnderConstruction view={view} />;
}

function App() {
  useHashRouting();
  usePersistence();
  useDocumentRoute();
  useDocumentTitle();

  return (
    <TooltipProvider delayDuration={300}>
      <DropTarget>
        <Shell>
          <CurrentView />
        </Shell>
        <IdentityDialog />
        <ConflictDialog />
        <MergeDialog />
        <RecoveryDialog />
        <InvalidDocumentDialog />
        <BufferRecoveryDialog />
        <CompressionOfferDialog />
        <Toaster />
      </DropTarget>
    </TooltipProvider>
  );
}

export default App;
