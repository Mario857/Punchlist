import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary/ErrorBoundary';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { assertNever } from '@renderer/lib/assertNever';
import { Audit } from '@renderer/screens/Audit/Audit';
import { Conventions } from '@renderer/screens/Conventions/Conventions';
import { Settings } from '@renderer/screens/Settings/Settings';
import { Workspace } from '@renderer/screens/Workspace/Workspace';
import { AppNav } from './AppNav';
import { SCREEN, useApp } from './useApp';

/**
 * Retries are off by default: these queries cross IPC to a local process, so a
 * failure is a real condition — gh missing, not authenticated, no repo access —
 * that retrying cannot fix, and a retried search call spends a rate-limited quota.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

export default function App() {
  const {
    screen,
    isSessionHydrated,
    onOpenWorkspace,
    onOpenConventions,
    onOpenAudit,
    onOpenSettings,
  } = useApp();

  const content = (() => {
    // Rendering before hydration would flash an empty workspace and then jump to
    // the restored PR.
    if (!isSessionHydrated) {
      return (
        <div className="grid flex-1 place-items-center">
          <Spinner size={SPINNER_SIZE.LG} label="Restoring your last session" />
        </div>
      );
    }
    switch (screen) {
      case SCREEN.WORKSPACE:
        return <Workspace />;
      case SCREEN.CONVENTIONS:
        return <Conventions />;
      case SCREEN.AUDIT:
        return <Audit />;
      case SCREEN.SETTINGS:
        return <Settings />;
      default:
        return assertNever(screen);
    }
  })();

  // Outermost, so a throw from any screen, module or provider below still lands on
  // something with a way back rather than blanking the window.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <div className="font-body text-ink flex h-full min-h-0 flex-col">
          <AppNav
            screen={screen}
            onOpenWorkspace={onOpenWorkspace}
            onOpenConventions={onOpenConventions}
            onOpenAudit={onOpenAudit}
            onOpenSettings={onOpenSettings}
          />
          {content}
        </div>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
