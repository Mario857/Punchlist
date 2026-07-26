import { useState } from 'react';
import { useRunEventStream } from '@renderer/hooks/useRunEventStream';
import { useSessionRestore } from '@renderer/hooks/useSessionRestore';

export const SCREEN = {
  WORKSPACE: 'workspace',
  SETTINGS: 'settings',
} as const;

export type Screen = (typeof SCREEN)[keyof typeof SCREEN];

interface UseAppResult {
  screen: Screen;
  isSessionHydrated: boolean;
  onOpenWorkspace: () => void;
  onOpenSettings: () => void;
}

/**
 * The app has two screens and no URL, so a state value beats pulling in a router.
 * Nothing else needs to read it, which is why it stays local rather than becoming
 * another global store.
 */
export function useApp(): UseAppResult {
  const [screen, setScreen] = useState<Screen>(SCREEN.WORKSPACE);
  const { isSessionHydrated } = useSessionRestore();
  // Subscribed once here rather than per pane: the bridge returns an unsubscribe
  // function, so a second mount would double every streamed event.
  useRunEventStream();

  return {
    screen,
    isSessionHydrated,
    onOpenWorkspace: () => setScreen(SCREEN.WORKSPACE),
    onOpenSettings: () => setScreen(SCREEN.SETTINGS),
  };
}
