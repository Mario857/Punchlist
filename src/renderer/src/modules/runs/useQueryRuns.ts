import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrRef } from '@shared/discovery';
import type { CandidatePatch, RunRecord, SandboxUsage, StartRunRequest } from '@shared/runs';
import { logError } from '@renderer/lib/logError';
import { createQueryKey } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';
import { useRunStore } from '@renderer/stores/runStore';

const RUNS_QUERY_DOMAIN = 'runs';
const SANDBOX_QUERY_DOMAIN = 'sandbox';
const LIST_SCOPE = 'list';
const PATCH_SCOPE = 'patch';
const USAGE_SCOPE = 'usage';

/**
 * Run reads are keyed here rather than in `lib/queryKeys.ts` because they are owned
 * by this module; they still go through `createQueryKey` so a key stays a comparable
 * literal tuple instead of an ad-hoc array at a call site.
 */
export const runsQueryKeys = {
  list: (repoKey: string, prNumber: number) =>
    createQueryKey(RUNS_QUERY_DOMAIN, LIST_SCOPE, repoKey, prNumber),
  /**
   * Keyed by revision as well as run: every hand edit, targeted edit and decision
   * continuation is its own commit, so a bumped counter is exactly when the patch
   * on disk stopped matching the one already fetched.
   */
  candidatePatch: (runId: string, revisionCount: number) =>
    createQueryKey(RUNS_QUERY_DOMAIN, PATCH_SCOPE, runId, revisionCount),
  sandboxUsage: () => createQueryKey(SANDBOX_QUERY_DOMAIN, USAGE_SCOPE),
} as const;

const NO_PR_REPO_KEY = '';
const NO_PR_NUMBER = 0;

interface UseQueryRunsResult {
  runs: RunRecord[] | undefined;
  isRunsLoading: boolean;
  runsError: unknown;
}

/**
 * Hydrates the run store for one PR. Runs persist across restarts, so without this
 * the store would open empty and a comment resolved yesterday would look untouched.
 *
 * The store is filled inside the `queryFn` rather than from an effect over the
 * query's data: copying query output into a store on mount is the documented
 * mirroring antipattern, and it would also be a `setState` inside an effect.
 */
export function useQueryRuns(ref: PrRef | null): UseQueryRunsResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { data, isLoading, error } = useQuery({
    queryKey: runsQueryKeys.list(ref?.repoKey ?? NO_PR_REPO_KEY, ref?.number ?? NO_PR_NUMBER),
    queryFn: async () => {
      // The query is disabled without a ref, so this only guards the type.
      if (ref === null) return [];
      const runs = unwrapIpcResult(await requireBridge().runs.list(ref));
      hydrate(runs);
      return runs;
    },
    enabled: ref !== null,
  });

  return { runs: data, isRunsLoading: isLoading, runsError: error };
}

interface UseQueryCandidatePatchResult {
  candidatePatch: CandidatePatch | undefined;
  isCandidatePatchLoading: boolean;
  candidatePatchError: unknown;
}

/** The patch is read from git in main, never from an editor buffer. */
export function useQueryCandidatePatch(
  runId: string,
  revisionCount: number,
): UseQueryCandidatePatchResult {
  const { data, isLoading, error } = useQuery({
    queryKey: runsQueryKeys.candidatePatch(runId, revisionCount),
    queryFn: async () => unwrapIpcResult(await requireBridge().runs.getPatch(runId)),
  });

  return {
    candidatePatch: data,
    isCandidatePatchLoading: isLoading,
    candidatePatchError: error,
  };
}

interface UseQuerySandboxUsageResult {
  sandboxUsage: SandboxUsage | undefined;
  isSandboxUsageLoading: boolean;
  sandboxUsageError: unknown;
}

export function useQuerySandboxUsage(): UseQuerySandboxUsageResult {
  const { data, isLoading, error } = useQuery({
    queryKey: runsQueryKeys.sandboxUsage(),
    queryFn: async () => unwrapIpcResult(await requireBridge().sandbox.getUsage()),
  });

  return { sandboxUsage: data, isSandboxUsageLoading: isLoading, sandboxUsageError: error };
}

interface UseExecuteStartRunResult {
  startRuns: (requests: StartRunRequest[]) => void;
  isStartRunsPending: boolean;
  startRunsError: unknown;
}

/**
 * Starting is a batch operation: the tree selects a set of comments and the queue in
 * main decides how many of them run at once.
 */
export function useExecuteStartRun(ref: PrRef | null): UseExecuteStartRunResult {
  const queryClient = useQueryClient();
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (requests: StartRunRequest[]) => {
      // The button is disabled without a PR, so this only guards the type.
      if (ref === null) return [];
      return unwrapIpcResult(await requireBridge().runs.start(ref, requests));
    },
    onSuccess: (started) => {
      // The created records are authoritative, so the store shows them immediately
      // instead of waiting for the first streamed state change.
      hydrate(started);
      void queryClient.invalidateQueries({ queryKey: runsQueryKeys.sandboxUsage() });
    },
    onError: (mutationError) => logError(mutationError, 'useExecuteStartRun'),
  });

  return { startRuns: mutate, isStartRunsPending: isPending, startRunsError: error };
}

interface UseExecuteCancelRunResult {
  cancelRun: (runId: string) => void;
  isCancelRunPending: boolean;
  cancelRunError: unknown;
}

export function useExecuteCancelRun(): UseExecuteCancelRunResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (runId: string) => unwrapIpcResult(await requireBridge().runs.cancel(runId)),
    onSuccess: (cancelled) => hydrate([cancelled]),
    onError: (mutationError) => logError(mutationError, 'useExecuteCancelRun'),
  });

  return { cancelRun: mutate, isCancelRunPending: isPending, cancelRunError: error };
}

interface UseExecuteDismissRunResult {
  dismissRun: (runId: string) => void;
  isDismissRunPending: boolean;
  dismissRunError: unknown;
}

/** Dismissing tears the worktree down in main, so the sandbox usage figure changes. */
export function useExecuteDismissRun(): UseExecuteDismissRunResult {
  const queryClient = useQueryClient();
  const forgetRun = useRunStore((state) => state.forgetRun);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (runId: string) => {
      unwrapIpcResult(await requireBridge().runs.dismiss(runId));
      return runId;
    },
    onSuccess: (runId) => {
      forgetRun(runId);
      void queryClient.invalidateQueries({ queryKey: runsQueryKeys.sandboxUsage() });
    },
    onError: (mutationError) => logError(mutationError, 'useExecuteDismissRun'),
  });

  return { dismissRun: mutate, isDismissRunPending: isPending, dismissRunError: error };
}

interface UseExecuteSandboxCleanupResult {
  cleanupSandbox: () => void;
  isSandboxCleanupPending: boolean;
  sandboxCleanupError: unknown;
  /** The usage reported by the last cleanup; undefined until one has run. */
  cleanedSandboxUsage: SandboxUsage | undefined;
}

/**
 * Only terminal runs are reclaimable and a dirty worktree is never force-removed, so
 * a cleanup can legitimately leave worktrees behind. The result is returned rather
 * than discarded precisely so the caller can say so.
 */
export function useExecuteSandboxCleanup(): UseExecuteSandboxCleanupResult {
  const queryClient = useQueryClient();

  const { mutate, isPending, error, data } = useMutation({
    mutationFn: async () => unwrapIpcResult(await requireBridge().sandbox.cleanupTerminal()),
    onSuccess: (usage) => {
      queryClient.setQueryData(runsQueryKeys.sandboxUsage(), usage);
    },
    onError: (mutationError) => logError(mutationError, 'useExecuteSandboxCleanup'),
  });

  return {
    cleanupSandbox: mutate,
    isSandboxCleanupPending: isPending,
    sandboxCleanupError: error,
    cleanedSandboxUsage: data,
  };
}
