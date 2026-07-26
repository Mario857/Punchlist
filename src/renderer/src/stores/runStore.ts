import { useMemo } from 'react';
import { create } from 'zustand';
import { prRefKey, type PrRef } from '@shared/discovery';
import { RUN_EVENT_KIND, type RunEvent, type RunRecord } from '@shared/runs';
import { isRunActive, type RunState } from '@shared/runState';
import { assertNever } from '@renderer/lib/assertNever';

export type RunsById = Readonly<Record<string, RunRecord>>;

/**
 * Run state is Zustand rather than TanStack Query because it arrives as a stream of
 * IPC events — state transitions and transcript chunks — and a request/response
 * cache is the wrong shape for push. It is local process state mirroring main, not
 * server data, so it does not violate the never-server-data-in-a-store rule.
 *
 * The store is a *projection* of main's state: a state change carries the whole
 * record and replaces it outright, so the two can never drift into disagreement.
 */
interface RunStore {
  runsById: RunsById;
  /** Seeds persisted runs on PR selection, so the store never starts empty after a restart. */
  hydrate: (runs: readonly RunRecord[]) => void;
  applyRunEvent: (event: RunEvent) => void;
  /** Drops a dismissed run, whose worktree main has already torn down. */
  forgetRun: (runId: string) => void;
}

export const useRunStore = create<RunStore>((set) => ({
  runsById: {},

  // An upsert rather than a wholesale replace: list() is scoped to one PR while the
  // event stream covers every run, so replacing would drop live records belonging to
  // a PR that is no longer selected.
  hydrate: (runs) =>
    set((state) => {
      const runsById = { ...state.runsById };
      for (const run of runs) runsById[run.id] = run;
      return { runsById };
    }),

  applyRunEvent: (event) =>
    set((state) => {
      switch (event.kind) {
        case RUN_EVENT_KIND.STATE_CHANGED:
          return { runsById: { ...state.runsById, [event.run.id]: event.run } };
        case RUN_EVENT_KIND.TRANSCRIPT_APPENDED: {
          const existing = state.runsById[event.runId];
          // A chunk for an unknown run has nothing to append to. Inventing a record
          // from it would produce a run with no state, tier or worktree.
          if (existing === undefined) return state;
          const appended = { ...existing, transcript: existing.transcript + event.chunk };
          return { runsById: { ...state.runsById, [event.runId]: appended } };
        }
        default:
          return assertNever(event);
      }
    }),

  forgetRun: (runId) =>
    set((state) => {
      const runsById = { ...state.runsById };
      delete runsById[runId];
      return { runsById };
    }),
}));

/**
 * A comment can be run more than once, so "the run for this comment" is the newest
 * one. Ordering on createdAt keeps that deterministic rather than dependent on
 * insertion order.
 */
export function selectRunForComment(
  runsById: RunsById,
  commentId: string | null,
): RunRecord | null {
  if (commentId === null) return null;

  let latest: RunRecord | null = null;
  for (const run of Object.values(runsById)) {
    if (run.commentId !== commentId) continue;
    if (latest === null || run.createdAt > latest.createdAt) latest = run;
  }
  return latest;
}

function buildRunStateByCommentId(runsById: RunsById): Readonly<Record<string, RunState>> {
  const stateByCommentId: Record<string, RunState> = {};
  const latestByCommentId = new Map<string, RunRecord>();

  for (const run of Object.values(runsById)) {
    const latest = latestByCommentId.get(run.commentId);
    if (latest === undefined || run.createdAt > latest.createdAt) {
      latestByCommentId.set(run.commentId, run);
    }
  }
  for (const [commentId, run] of latestByCommentId) stateByCommentId[commentId] = run.state;
  return stateByCommentId;
}

function selectRunsForPr(runsById: RunsById, refKey: string | null): RunRecord[] {
  if (refKey === null) return [];
  return Object.values(runsById).filter((run) => prRefKey(run.prRef) === refKey);
}

/** The record itself, so a transcript chunk on another run does not re-render this pane. */
export function useRunForComment(commentId: string | null): RunRecord | null {
  return useRunStore((state) => selectRunForComment(state.runsById, commentId));
}

export function useRun(runId: string | null): RunRecord | null {
  return useRunStore((state) => (runId === null ? null : (state.runsById[runId] ?? null)));
}

/**
 * What the comment tree consumes for its row badges. Derived here rather than kept
 * in the store, so there is no second copy to drift, and memoised because a selector
 * that built the record inline would return a new object on every event.
 */
export function useRunStateByCommentId(): Readonly<Record<string, RunState>> {
  const runsById = useRunStore((state) => state.runsById);
  return useMemo(() => buildRunStateByCommentId(runsById), [runsById]);
}

export function useRunsForPr(ref: PrRef | null): RunRecord[] {
  const runsById = useRunStore((state) => state.runsById);
  const refKey = ref === null ? null : prRefKey(ref);
  return useMemo(() => selectRunsForPr(runsById, refKey), [runsById, refKey]);
}

/** queued, running and revising — the runs a cancel can still reach. */
export function useActiveRunsForPr(ref: PrRef | null): RunRecord[] {
  const runsForPr = useRunsForPr(ref);
  return useMemo(() => runsForPr.filter((run) => isRunActive(run.state)), [runsForPr]);
}
