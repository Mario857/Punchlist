import { useQuery } from '@tanstack/react-query';
import type { UndoableLanding } from '@shared/landing';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQueryUndoableLandingResult {
  /**
   * Null once no landing is reversible from here — either none has happened or the
   * most recent one has been superseded. Undefined only until the first read resolves.
   */
  undoableLanding: UndoableLanding | null | undefined;
  isUndoableLandingLoading: boolean;
  undoableLandingError: unknown;
}

/**
 * Whether the last landing is still the one an undo may reverse. Main decides that
 * from its own audit record, and only this app's own landings and undos can change the
 * answer — so nothing polls it and nothing refetches it on focus; the two mutations
 * that can move it invalidate it instead.
 */
export function useQueryUndoableLanding(): UseQueryUndoableLandingResult {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.undoableLanding(),
    queryFn: async () => unwrapIpcResult(await requireBridge().landing.undoable()),
  });

  return {
    undoableLanding: data,
    isUndoableLandingLoading: isLoading,
    undoableLandingError: error,
  };
}
