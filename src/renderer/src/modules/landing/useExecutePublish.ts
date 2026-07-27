import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PushBranchRequest,
  PushBranchResult,
  ResolveLandedThreadsRequest,
  ResolveLandedThreadsResult,
} from '@shared/landing';
import { logError } from '@renderer/lib/logError';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseExecutePushBranchResult {
  pushBranch: (request: PushBranchRequest) => void;
  /** What main reports it pushed; undefined until a push has succeeded. */
  pushBranchResult: PushBranchResult | undefined;
  isPushBranchPending: boolean;
  pushBranchError: unknown;
}

/**
 * The publish half of a local landing, on demand rather than as part of it: the
 * landing put the commits on the branch, and this is the separate decision to send
 * that branch to its remote. Nothing optimistic — a push is a fact main reports.
 */
export function useExecutePushBranch(): UseExecutePushBranchResult {
  const queryClient = useQueryClient();

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async (request: PushBranchRequest) =>
      unwrapIpcResult(await requireBridge().landing.pushBranch(request)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditLog() });
    },
    onError: (mutationError) => logError(mutationError, 'useExecutePushBranch'),
  });

  return {
    pushBranch: mutate,
    pushBranchResult: data,
    isPushBranchPending: isPending,
    pushBranchError: error,
  };
}

interface UseExecuteResolveThreadsResult {
  resolveThreads: (request: ResolveLandedThreadsRequest) => void;
  /** Which threads main actually resolved; undefined until the action has run. */
  resolveThreadsResult: ResolveLandedThreadsResult | undefined;
  isResolveThreadsPending: boolean;
  resolveThreadsError: unknown;
}

/**
 * Resolves the threads of every comment a landed run addressed, skipping ones already
 * resolved. Derived from the applied runs and a fresh comment fetch, so it can run at
 * any point after a landing — typically after the push has made the fixes visible.
 */
export function useExecuteResolveThreads(): UseExecuteResolveThreadsResult {
  const queryClient = useQueryClient();

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async (request: ResolveLandedThreadsRequest) =>
      unwrapIpcResult(await requireBridge().landing.resolveThreads(request)),
    onSettled: (_result, _error, request) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditLog() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prComments(request.prRef.repoKey, request.prRef.number),
      });
    },
    onError: (mutationError) => logError(mutationError, 'useExecuteResolveThreads'),
  });

  return {
    resolveThreads: mutate,
    resolveThreadsResult: data,
    isResolveThreadsPending: isPending,
    resolveThreadsError: error,
  };
}
