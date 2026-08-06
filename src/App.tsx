import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Shell } from '@/components/shell/Shell';
import { UnderConstruction } from '@/components/shell/UnderConstruction';
import { HomeScreen } from '@/components/home/HomeScreen';
import { IdentityDialog } from '@/components/dialogs/IdentityDialog';
import { useHashRouting } from '@/hooks/useHashRouting';
import { useUiStore } from '@/store/ui-store';

function CurrentView() {
  const view = useUiStore((s) => s.view);
  if (view === 'home') return <HomeScreen />;
  return <UnderConstruction view={view} />;
}

function App() {
  useHashRouting();

  return (
    <TooltipProvider delayDuration={300}>
      <Shell>
        <CurrentView />
      </Shell>
      <IdentityDialog />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
