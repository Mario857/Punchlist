import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExecuteLandingRequest, LandingResult } from '@shared/landing';
import { logError } from '@renderer/lib/logError';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';
import { runsQueryKeys } from '@renderer/modules/runs/useQueryRuns';

interface UseExecuteLandingResult {
  executeLanding: (request: ExecuteLandingRequest) => void;
  /** What main reports it actually did; undefined until a landing has succeeded. */
  landingResult: LandingResult | undefined;
  isLandingExecuting: boolean;
  /**
   * Surfaced rather than swallowed, and never treated as "nothing happened": the
   * sequence can fail after the branch is already pushed.
   */
  landingError: unknown;
}

/**
 * The only mutation in the app that reaches outside the sandbox. Nothing here is
 * optimistic — a push, a resolved thread and a posted reply are facts main reports,
 * never states the UI shows ahead of it.
 */
export function useExecuteLanding(): UseExecuteLandingResult {
  const queryClient = useQueryClient();

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async (request: ExecuteLandingRequest) =>
      unwrapIpcResult(await requireBridge().landing.execute(request)),
    // onSettled rather than onSuccess: publishing, pushing, resolving and replying run
    // in sequence and are not atomic, so a failure halfway through has still changed the
    // remote, the threads and the runs. Refreshing only on success would leave the screen
    // describing a repository state that no longer exists — and would hide the undo that
    // a partially completed landing may now have made available.
    onSettled: (_result, _error, request) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditLog() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.undoableLanding() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.landingPreviews() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prComments(request.prRef.repoKey, request.prRef.number),
      });
      void queryClient.invalidateQueries({
        queryKey: runsQueryKeys.list(request.prRef.repoKey, request.prRef.number),
      });
    },
    // The request carries commit bodies and the reply text, so only the failure is
    // logged — never the payload.
    onError: (mutationError) => logError(mutationError, 'useExecuteLanding'),
  });

  return {
    executeLanding: mutate,
    landingResult: data,
    isLandingExecuting: isPending,
    landingError: error,
  };
}
