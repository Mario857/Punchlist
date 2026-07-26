import { useEffect } from 'react';
import { logError } from '@renderer/lib/logError';
import { requireBridge } from '@renderer/lib/unwrapIpcResult';
import { useRunStore } from '@renderer/stores/runStore';

/**
 * Feeds streamed run progress into the run store. Mounted exactly once, at the app
 * root: `onEvent` returns its own unsubscribe, so a second mount would install a
 * second listener and double every state change and every transcript chunk.
 *
 * Cross-module rather than owned by a feature, because the store it fills is read by
 * the comment tree, the run controls and the review pane alike.
 */
export function useRunEventStream(): void {
  const applyRunEvent = useRunStore((state) => state.applyRunEvent);

  useEffect(() => {
    try {
      return requireBridge().runs.onEvent(applyRunEvent);
    } catch (error: unknown) {
      // A missing bridge is a wiring bug, not a state to render: without the stream
      // runs still start, they just stop reporting progress.
      logError(error, 'useRunEventStream.subscribe');
      return undefined;
    }
  }, [applyRunEvent]);
}
