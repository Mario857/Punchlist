import { useEffect, useRef } from 'react';
import { logError } from '@renderer/lib/logError';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';
import { selectPersistableSession, useSessionStore } from '@renderer/stores/sessionStore';

/** Expansion and selection change on nearly every navigation keypress. */
const SESSION_PERSIST_DEBOUNCE_MS = 400;

interface UseSessionRestoreResult {
  isSessionHydrated: boolean;
}

/**
 * Hydrates the session from main once, then persists changes back debounced.
 * Mounted a single time at the app root — a second mount would install a second
 * subscription and double every write.
 */
export function useSessionRestore(): UseSessionRestoreResult {
  const isSessionHydrated = useSessionStore((state) => state.isHydrated);
  const hydrate = useSessionStore((state) => state.hydrate);
  const debounceHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async (): Promise<void> => {
      try {
        const session = unwrapIpcResult(await requireBridge().session.get());
        if (isMounted) hydrate(session);
      } catch (error) {
        // A restart that cannot restore is a degraded start, not a broken one, so
        // the store keeps its defaults and the app opens empty.
        logError(error, 'useSessionRestore.load');
        if (isMounted) hydrate(useSessionStore.getState());
      }
    };

    void loadSession();

    return () => {
      isMounted = false;
    };
  }, [hydrate]);

  useEffect(() => {
    if (!isSessionHydrated) return undefined;

    const unsubscribe = useSessionStore.subscribe((state) => {
      if (debounceHandleRef.current !== null) clearTimeout(debounceHandleRef.current);

      debounceHandleRef.current = setTimeout(() => {
        const persist = async (): Promise<void> => {
          try {
            unwrapIpcResult(await requireBridge().session.update(selectPersistableSession(state)));
          } catch (error) {
            logError(error, 'useSessionRestore.persist');
          }
        };
        void persist();
      }, SESSION_PERSIST_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (debounceHandleRef.current !== null) clearTimeout(debounceHandleRef.current);
    };
  }, [isSessionHydrated]);

  return { isSessionHydrated };
}
