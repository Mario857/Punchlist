import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrRef } from '@shared/discovery';
import type {
  CandidatePatch,
  ContinueRunRequest,
  EscalateRunRequest,
  RevertRunRequest,
  RunRecord,
  RunRevision,
  SandboxUsage,
  StartRunRequest,
  WriteRunFileRequest,
} from '@shared/runs';
import { logError } from '@renderer/lib/logError';
import { createQueryKey, queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';
import { useRunStore } from '@renderer/stores/runStore';

const RUNS_QUERY_DOMAIN = 'runs';
const SANDBOX_QUERY_DOMAIN = 'sandbox';
const AUTO_MODE_QUERY_DOMAIN = 'autoMode';
const LIST_SCOPE = 'list';
const PATCH_SCOPE = 'patch';
const USAGE_SCOPE = 'usage';
const ENABLED_SCOPE = 'enabled';

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
  autoModeEnabled: () => createQueryKey(AUTO_MODE_QUERY_DOMAIN, ENABLED_SCOPE),
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

/**
 * The patch is read from git in main, never from an editor buffer.
 *
 * A revision changes the key, and dropping to a spinner there would unmount the diff
 * editor — losing the cursor mid-hand-edit, since a hand edit is itself a revision. The
 * previous patch therefore stays on screen until the new one arrives.
 */
export function useQueryCandidatePatch(
  runId: string,
  revisionCount: number,
): UseQueryCandidatePatchResult {
  const { data, isLoading, error } = useQuery({
    queryKey: runsQueryKeys.candidatePatch(runId, revisionCount),
    queryFn: async () => unwrapIpcResult(await requireBridge().runs.getPatch(runId)),
    placeholderData: keepPreviousData,
  });

  return {
    candidatePatch: data,
    isCandidatePatchLoading: isLoading,
    candidatePatchError: error,
  };
}

interface UseQueryRunRevisionsResult {
  runRevisions: RunRevision[] | undefined;
  isRunRevisionsLoading: boolean;
  runRevisionsError: unknown;
}

/**
 * The worktree's commit trail, newest first. Keyed by revision count for the same
 * reason the patch is: a revision commit is what changed the trail, so the counter is
 * what says the fetched list is stale.
 */
export function useQueryRunRevisions(
  runId: string,
  revisionCount: number,
): UseQueryRunRevisionsResult {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.runRevisions(runId, revisionCount),
    queryFn: async () => unwrapIpcResult(await requireBridge().runs.listRevisions(runId)),
  });

  return { runRevisions: data, isRunRevisionsLoading: isLoading, runRevisionsError: error };
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

interface UseQueryAutoModeEnabledResult {
  /** Undefined only until the first read resolves; main is the single owner of it. */
  isAutoModeEnabled: boolean | undefined;
  isAutoModeEnabledLoading: boolean;
  autoModeEnabledError: unknown;
}

/**
 * Auto mode is per-session process state in main, off on every app start so it cannot
 * be left on by accident. Reading it over IPC rather than keeping it in the session
 * store is what makes that true: the session store is persisted, so a flag mirrored
 * into it would survive the restart that is supposed to clear it.
 */
export function useQueryAutoModeEnabled(): UseQueryAutoModeEnabledResult {
  const { data, isLoading, error } = useQuery({
    queryKey: runsQueryKeys.autoModeEnabled(),
    queryFn: async () => unwrapIpcResult(await requireBridge().autoMode.isEnabled()),
  });

  return {
    isAutoModeEnabled: data,
    isAutoModeEnabledLoading: isLoading,
    autoModeEnabledError: error,
  };
}

interface UseExecuteSetAutoModeResult {
  setAutoModeEnabled: (isEnabled: boolean) => void;
  isSetAutoModePending: boolean;
  setAutoModeError: unknown;
}

/**
 * Main returns the state it settled on, so the cache is written from the response
 * rather than optimistically: the toggle must never show "on" for a mode main did not
 * actually enter.
 */
export function useExecuteSetAutoMode(): UseExecuteSetAutoModeResult {
  const queryClient = useQueryClient();

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (isEnabled: boolean) =>
      unwrapIpcResult(await requireBridge().autoMode.setEnabled(isEnabled)),
    onSuccess: (isEnabled) => {
      queryClient.setQueryData(runsQueryKeys.autoModeEnabled(), isEnabled);
    },
    onError: (mutationError) => logError(mutationError, 'useExecuteSetAutoMode'),
  });

  return {
    setAutoModeEnabled: mutate,
    isSetAutoModePending: isPending,
    setAutoModeError: error,
  };
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

interface UseExecuteStopAllRunsResult {
  stopAllRuns: () => void;
  isStopAllRunsPending: boolean;
  stopAllRunsError: unknown;
}

/**
 * One action for a bad batch rather than one cancel per agent. Main returns every run
 * it stopped, so the store learns all of them from the response instead of waiting on
 * a dozen streamed transitions.
 */
export function useExecuteStopAllRuns(): UseExecuteStopAllRunsResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async () => unwrapIpcResult(await requireBridge().runs.stopAll()),
    onSuccess: (stopped) => hydrate(stopped),
    onError: (mutationError) => logError(mutationError, 'useExecuteStopAllRuns'),
  });

  return { stopAllRuns: mutate, isStopAllRunsPending: isPending, stopAllRunsError: error };
}

interface UseExecuteContinueRunResult {
  continueRun: (request: ContinueRunRequest) => void;
  isContinueRunPending: boolean;
  continueRunError: unknown;
}

/**
 * The decision reply and the whole-patch follow-up are one mechanism — `agent.send` on
 * the same agent — so they share one mutation. What the continuation *means* is decided
 * in main from the run's state, which is why the request carries only a message.
 *
 * Sends are serialized per run in main, so the mutation stays pending until that run's
 * turn completes rather than resolving early on a queued send. The returned record is
 * authoritative and the store also receives the streamed transition, so there is
 * nothing optimistic to patch here.
 */
export function useExecuteContinueRun(): UseExecuteContinueRunResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (request: ContinueRunRequest) =>
      unwrapIpcResult(await requireBridge().runs.continueRun(request)),
    onSuccess: (continued) => hydrate([continued]),
    onError: (mutationError) => logError(mutationError, 'useExecuteContinueRun'),
  });

  return { continueRun: mutate, isContinueRunPending: isPending, continueRunError: error };
}

interface UseExecuteWriteRunFileResult {
  writeRunFile: (request: WriteRunFileRequest) => void;
  isWriteRunFilePending: boolean;
  /** A rejected write — a protected path, a vanished worktree — must stay visible. */
  writeRunFileError: unknown;
}

/**
 * Writes a hand-edited file back into the run's worktree. Main re-reads the patch from
 * git after the write, so both reads keyed by the run's revision counter are
 * invalidated rather than the editor buffer being treated as the truth: an edit to a
 * file the agent also touched cannot desync the view that way.
 */
export function useExecuteWriteRunFile(): UseExecuteWriteRunFileResult {
  const queryClient = useQueryClient();
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (request: WriteRunFileRequest) =>
      unwrapIpcResult(await requireBridge().runs.writeFile(request)),
    onSuccess: (written) => {
      hydrate([written]);
      void queryClient.invalidateQueries({
        queryKey: runsQueryKeys.candidatePatch(written.id, written.revisionCount),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runRevisions(written.id, written.revisionCount),
      });
    },
    // The request carries file contents, so only the failure is logged, never the edit.
    onError: (mutationError) => logError(mutationError, 'useExecuteWriteRunFile'),
  });

  return { writeRunFile: mutate, isWriteRunFilePending: isPending, writeRunFileError: error };
}

interface UseExecuteRevertRunResult {
  revertRun: (request: RevertRunRequest) => void;
  isRevertRunPending: boolean;
  /** A WORKTREE_DIRTY error here is the request for confirmation, not a failure. */
  revertRunError: unknown;
}

/**
 * Rewinds the worktree to one of its own revisions, discarding every later one. The
 * error is surfaced rather than swallowed because main refuses a reset that would
 * discard hand-edits, and that refusal is what drives the confirmation step.
 *
 * Both reads have to be invalidated by hand: the revision counter only ever counts
 * forward, so a revert leaves it untouched while changing both the trail and the patch
 * it keys. The returned record is authoritative and the streamed transition arrives
 * with it, so there is nothing optimistic to patch.
 */
export function useExecuteRevertRun(): UseExecuteRevertRunResult {
  const queryClient = useQueryClient();
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (request: RevertRunRequest) =>
      unwrapIpcResult(await requireBridge().runs.revert(request)),
    onSuccess: (reverted) => {
      hydrate([reverted]);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runRevisions(reverted.id, reverted.revisionCount),
      });
      void queryClient.invalidateQueries({
        queryKey: runsQueryKeys.candidatePatch(reverted.id, reverted.revisionCount),
      });
    },
    onError: (mutationError) => logError(mutationError, 'useExecuteRevertRun'),
  });

  return { revertRun: mutate, isRevertRunPending: isPending, revertRunError: error };
}

interface UseExecuteRerunConflictedResult {
  rerunConflicted: (runId: string) => void;
  isRerunConflictedPending: boolean;
  rerunConflictedError: unknown;
}

/**
 * A conflicting patch is reconciled by its own agent against the integration state,
 * so this starts a real run: progress arrives on the event stream like any other, and
 * the landing preview has to be assembled again once it settles.
 */
export function useExecuteRerunConflicted(): UseExecuteRerunConflictedResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (runId: string) =>
      unwrapIpcResult(await requireBridge().runs.rerunConflicted(runId)),
    onSuccess: (rerun) => hydrate([rerun]),
    onError: (mutationError) => logError(mutationError, 'useExecuteRerunConflicted'),
  });

  return {
    rerunConflicted: mutate,
    isRerunConflictedPending: isPending,
    rerunConflictedError: error,
  };
}

interface UseExecuteApproveRunsResult {
  approveRuns: (runIds: string[]) => void;
  isApproveRunsPending: boolean;
  approveRunsError: unknown;
}

/**
 * Marks runs ready to land, and marks nothing else. Nothing reachable from here
 * touches a branch, a remote or GitHub — the landing gate is still ahead of every
 * approved run — which is exactly what makes approving a batch at once safe.
 *
 * Batched at the IPC level even for one run, because main resolves and checks every
 * id before committing the first transition. The returned records are authoritative
 * and the streamed transitions arrive with them, so there is nothing optimistic to
 * patch: an approval must never read as done before main says it is.
 */
export function useExecuteApproveRuns(): UseExecuteApproveRunsResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (runIds: string[]) =>
      unwrapIpcResult(await requireBridge().runs.approve(runIds)),
    onSuccess: (approved) => hydrate(approved),
    onError: (mutationError) => logError(mutationError, 'useExecuteApproveRuns'),
  });

  return { approveRuns: mutate, isApproveRunsPending: isPending, approveRunsError: error };
}

interface UseExecuteRejectRunsResult {
  rejectRuns: (runIds: string[]) => void;
  isRejectRunsPending: boolean;
  rejectRunsError: unknown;
}

/**
 * Turns resolutions down without tearing anything down: the record and the worktree
 * survive until the run is dismissed, which is the separate action that reclaims them.
 * Guardrail flags do not gate this one — they exist to stop unread work being
 * approved, and rejecting is the outcome they were raised to protect.
 */
export function useExecuteRejectRuns(): UseExecuteRejectRunsResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (runIds: string[]) =>
      unwrapIpcResult(await requireBridge().runs.reject(runIds)),
    onSuccess: (rejected) => hydrate(rejected),
    onError: (mutationError) => logError(mutationError, 'useExecuteRejectRuns'),
  });

  return { rejectRuns: mutate, isRejectRunsPending: isPending, rejectRunsError: error };
}

interface UseExecuteRequestSecondOpinionResult {
  requestSecondOpinion: (runIds: string[]) => void;
  isRequestSecondOpinionPending: boolean;
  requestSecondOpinionError: unknown;
}

/**
 * Asks a fresh agent whether each patch does what its comment asked. Batched at the
 * IPC level even for one run, like approval, because main resolves every id before it
 * starts anything.
 *
 * Advisory by construction: the verdict lands on the run record and no state
 * transition reads it, so there is nothing to gate and nothing to invalidate beyond
 * the store the returned records hydrate.
 */
export function useExecuteRequestSecondOpinion(): UseExecuteRequestSecondOpinionResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (runIds: string[]) =>
      unwrapIpcResult(await requireBridge().runs.requestSecondOpinion(runIds)),
    onSuccess: (reviewed) => hydrate(reviewed),
    // A verdict quotes the patch it read, so only the failure is logged — never the
    // concerns that came back with it.
    onError: (mutationError) => logError(mutationError, 'useExecuteRequestSecondOpinion'),
  });

  return {
    requestSecondOpinion: mutate,
    isRequestSecondOpinionPending: isPending,
    requestSecondOpinionError: error,
  };
}

interface UseExecuteEscalateRunResult {
  escalateRun: (request: EscalateRunRequest) => void;
  isEscalateRunPending: boolean;
  /** A WORKTREE_DIRTY error here is the request for confirmation, not a failure. */
  escalateRunError: unknown;
}

/**
 * Retries a hard failure with a fresh agent against the worktree reset to base. The
 * error is surfaced rather than swallowed because main refuses a reset that would
 * discard hand-edits, and that refusal is what drives the confirmation step.
 */
export function useExecuteEscalateRun(): UseExecuteEscalateRunResult {
  const hydrate = useRunStore((state) => state.hydrate);

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (request: EscalateRunRequest) =>
      unwrapIpcResult(await requireBridge().runs.escalate(request)),
    onSuccess: (escalated) => hydrate([escalated]),
    onError: (mutationError) => logError(mutationError, 'useExecuteEscalateRun'),
  });

  return { escalateRun: mutate, isEscalateRunPending: isPending, escalateRunError: error };
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
