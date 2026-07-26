import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PrRef } from '@shared/discovery';
import type { UndoableLanding, UndoLandingRequest } from '@shared/landing';
import { logError } from '@renderer/lib/logError';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';
import { runsQueryKeys } from '@renderer/modules/runs/useQueryRuns';

export interface UseExecuteUndoLandingOptions {
  /**
   * The PR on screen, whose runs and comments an undo can change under the reader.
   * The undone landing may belong to another PR; nothing keeps those reads fresh
   * across a selection change, so they are re-read when that PR is opened.
   */
  prRef: PrRef | null;
}

interface UseExecuteUndoLandingResult {
  undoLanding: (request: UndoLandingRequest) => void;
  /** The landing that was reversed, so the result can be reported rather than assumed. */
  undoneLanding: UndoableLanding | undefined;
  isUndoLandingExecuting: boolean;
  undoLandingError: unknown;
}

/**
 * The reverse of a landing, and no less consequential: it deletes a pushed branch and
 * unresolves every thread the landing resolved. `isConfirmedByUser` is never set here —
 * the caller supplies it, and only after its own confirmation step.
 */
export function useExecuteUndoLanding({
  prRef,
}: UseExecuteUndoLandingOptions): UseExecuteUndoLandingResult {
  const queryClient = useQueryClient();

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async (request: UndoLandingRequest) =>
      unwrapIpcResult(await requireBridge().landing.undo(request)),
    // onSettled for the same reason the landing uses it: deleting the branch and
    // unresolving each thread are separate calls, so a failure partway through has still
    // changed the remote and GitHub.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditLog() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.undoableLanding() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.landingPreviews() });
      if (prRef === null) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prComments(prRef.repoKey, prRef.number),
      });
      void queryClient.invalidateQueries({
        queryKey: runsQueryKeys.list(prRef.repoKey, prRef.number),
      });
    },
    onError: (mutationError) => logError(mutationError, 'useExecuteUndoLanding'),
  });

  return {
    undoLanding: mutate,
    undoneLanding: data,
    isUndoLandingExecuting: isPending,
    undoLandingError: error,
  };
}
