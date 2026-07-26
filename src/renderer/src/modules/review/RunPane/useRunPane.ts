import type { AgentDecision, RunRecord } from '@shared/runs';
import { FAILURE_REASON, RUN_STATE, type RunState } from '@shared/runState';
import { assertNever } from '@renderer/lib/assertNever';
import { formatDuration } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { useRunForComment } from '@renderer/stores/runStore';

export const RUN_PANE_VIEW_KIND = {
  NO_RUN: 'noRun',
  TRANSCRIPT: 'transcript',
  DECISION: 'decision',
  DIFF: 'diff',
  NO_ACTION_NEEDED: 'noActionNeeded',
  FAILURE: 'failure',
} as const;

export type RunPaneViewKind = (typeof RUN_PANE_VIEW_KIND)[keyof typeof RUN_PANE_VIEW_KIND];

/**
 * Which surface the right pane shows, decided here rather than by a ternary chain in
 * markup. Each variant carries exactly the data its surface needs, so a view cannot be
 * rendered without it.
 */
export type RunPaneView =
  | { kind: typeof RUN_PANE_VIEW_KIND.NO_RUN; emptyStateLabel: string }
  | {
      kind: typeof RUN_PANE_VIEW_KIND.TRANSCRIPT;
      transcript: string;
      isStreaming: boolean;
      headline: string;
    }
  | { kind: typeof RUN_PANE_VIEW_KIND.DECISION; runId: string; decision: AgentDecision }
  | {
      kind: typeof RUN_PANE_VIEW_KIND.DIFF;
      runId: string;
      /** Non-null only while revising, which keeps the diff on screen but dimmed. */
      revisionProgressLabel: string | null;
    }
  | { kind: typeof RUN_PANE_VIEW_KIND.NO_ACTION_NEEDED; heading: string; explanation: string }
  | {
      kind: typeof RUN_PANE_VIEW_KIND.FAILURE;
      heading: string;
      explanation: string;
      /** Present only for startFailed, whose remedy lives in Settings. */
      settingsHint: string | null;
      errorMessage: string | null;
      transcript: string;
      tailLineCount: number;
    };

interface UseRunPaneResult {
  view: RunPaneView;
  /** Null before a run exists, which is what suppresses the header badge. */
  runState: RunState | null;
  /** Null before a run exists, rather than an empty line reading "--". */
  metaLabel: string | null;
}

const NO_COMMENT_LABEL = 'Select a comment to see how its run is going.';
const NO_RUN_LABEL = 'No run yet for this comment. Select it in the tree and start one.';

const QUEUED_HEADLINE = 'Waiting for a slot in the queue.';
const RUNNING_HEADLINE = 'The agent is working in its own worktree.';
const MALFORMED_DECISION_HEADLINE =
  'The agent halted to ask something, but its decision file could not be read. The transcript is the only record of what it wanted.';

const NO_ACTION_HEADING = 'Ran, produced nothing, and that was correct';
const NO_ACTION_EXPLANATION =
  'The agent read the comment, looked at the code, and concluded there was nothing to change. No worktree edits, no patch, nothing to review.';

const FAILURE_FALLBACK_HEADING = 'The run failed';
const FAILURE_FALLBACK_EXPLANATION =
  'It reached a failed state without recording a reason. The transcript below is the only record.';

const AGENT_ERROR_HEADING = 'The agent ran and failed';
const AGENT_ERROR_EXPLANATION =
  'It started, did work, and returned an error. The reason is in the transcript rather than in Airlock.';

const START_FAILED_HEADING = 'The agent never started';
const START_FAILED_EXPLANATION =
  'Creation failed before any work happened, so nothing was written and there is nothing to review.';
const START_FAILED_SETTINGS_HINT =
  'Check Settings: a Cursor API key must be stored, and the tier has to resolve to a model your plan can use.';

const TIMEOUT_HEADING = 'The run hit its time limit';
const TIMEOUT_EXPLANATION =
  'It was still working when the per-run maximum elapsed, which is not the same as an error: the work may simply be larger than one run. Narrow the comment or start it again.';

const WORKTREE_MISSING_HEADING = 'The sandbox is gone';
const WORKTREE_MISSING_EXPLANATION =
  'The worktree for this run was no longer on disk at startup, and a local agent is bound to its working directory, so it cannot be resumed. Start the comment again to rebuild the sandbox.';

const CANCELLED_HEADING = 'You stopped this run';
const CANCELLED_EXPLANATION =
  'It was cancelled before it finished. Everything it had done stayed inside the sandbox.';

const REVISING_LABEL = 'Revising the patch…';
const REVISION_LABEL_PREFIX = 'Revision ';
const META_SEPARATOR = ' · ';

/** A failure is diagnosed from the end of the output, not from the whole log. */
const FAILURE_TRANSCRIPT_TAIL_LINE_COUNT = 40;
const NO_REVISIONS = 0;

interface FailureCopy {
  heading: string;
  explanation: string;
  settingsHint: string | null;
}

function toFailureCopy(run: RunRecord): FailureCopy {
  if (!isDefined(run.failureReason)) {
    return {
      heading: FAILURE_FALLBACK_HEADING,
      explanation: FAILURE_FALLBACK_EXPLANATION,
      settingsHint: null,
    };
  }

  switch (run.failureReason) {
    case FAILURE_REASON.AGENT_ERROR:
      return {
        heading: AGENT_ERROR_HEADING,
        explanation: AGENT_ERROR_EXPLANATION,
        settingsHint: null,
      };
    case FAILURE_REASON.START_FAILED:
      return {
        heading: START_FAILED_HEADING,
        explanation: START_FAILED_EXPLANATION,
        settingsHint: START_FAILED_SETTINGS_HINT,
      };
    case FAILURE_REASON.TIMEOUT:
      return { heading: TIMEOUT_HEADING, explanation: TIMEOUT_EXPLANATION, settingsHint: null };
    case FAILURE_REASON.WORKTREE_MISSING:
      return {
        heading: WORKTREE_MISSING_HEADING,
        explanation: WORKTREE_MISSING_EXPLANATION,
        settingsHint: null,
      };
    case FAILURE_REASON.CANCELLED:
      return { heading: CANCELLED_HEADING, explanation: CANCELLED_EXPLANATION, settingsHint: null };
    default:
      return assertNever(run.failureReason);
  }
}

function toRevisionProgressLabel(run: RunRecord): string {
  if (run.revisionCount === NO_REVISIONS) return REVISING_LABEL;
  return `${REVISING_LABEL} ${REVISION_LABEL_PREFIX}${run.revisionCount}`;
}

function toView(run: RunRecord): RunPaneView {
  switch (run.state) {
    case RUN_STATE.QUEUED:
      return {
        kind: RUN_PANE_VIEW_KIND.TRANSCRIPT,
        transcript: run.transcript,
        isStreaming: true,
        headline: QUEUED_HEADLINE,
      };
    case RUN_STATE.RUNNING:
      return {
        kind: RUN_PANE_VIEW_KIND.TRANSCRIPT,
        transcript: run.transcript,
        isStreaming: true,
        headline: RUNNING_HEADLINE,
      };
    case RUN_STATE.NEEDS_DECISION:
      // decision.json is written by an LLM, so it can arrive unparseable and degrade to
      // null. The halt is still real, so the transcript stands in for the question.
      if (!isDefined(run.decision)) {
        return {
          kind: RUN_PANE_VIEW_KIND.TRANSCRIPT,
          transcript: run.transcript,
          isStreaming: false,
          headline: MALFORMED_DECISION_HEADLINE,
        };
      }
      return { kind: RUN_PANE_VIEW_KIND.DECISION, runId: run.id, decision: run.decision };
    case RUN_STATE.REVISING:
      return {
        kind: RUN_PANE_VIEW_KIND.DIFF,
        runId: run.id,
        revisionProgressLabel: toRevisionProgressLabel(run),
      };
    case RUN_STATE.READY:
    case RUN_STATE.APPROVED:
    case RUN_STATE.APPLIED:
      return { kind: RUN_PANE_VIEW_KIND.DIFF, runId: run.id, revisionProgressLabel: null };
    case RUN_STATE.NO_ACTION_NEEDED:
      return {
        kind: RUN_PANE_VIEW_KIND.NO_ACTION_NEEDED,
        heading: NO_ACTION_HEADING,
        explanation: NO_ACTION_EXPLANATION,
      };
    case RUN_STATE.FAILED: {
      const { heading, explanation, settingsHint } = toFailureCopy(run);
      return {
        kind: RUN_PANE_VIEW_KIND.FAILURE,
        heading,
        explanation,
        settingsHint,
        errorMessage: run.errorMessage,
        transcript: run.transcript,
        tailLineCount: FAILURE_TRANSCRIPT_TAIL_LINE_COUNT,
      };
    }
    default:
      return assertNever(run.state);
  }
}

function toMetaLabel(run: RunRecord): string {
  const parts: string[] = [run.tier];
  if (isDefined(run.model)) parts.push(run.model);
  if (isDefined(run.durationMs)) parts.push(formatDuration(run.durationMs));
  if (run.revisionCount > NO_REVISIONS) {
    parts.push(`${REVISION_LABEL_PREFIX}${run.revisionCount}`);
  }
  return parts.join(META_SEPARATOR);
}

/**
 * The right pane's whole behaviour is a function of `RunState`, exhausted with a
 * `switch` that ends in `assertNever` so a new state is a compile error rather than a
 * blank pane.
 */
export function useRunPane(commentId: string | null): UseRunPaneResult {
  const run = useRunForComment(commentId);

  if (!isDefined(run)) {
    return {
      view: {
        kind: RUN_PANE_VIEW_KIND.NO_RUN,
        emptyStateLabel: commentId === null ? NO_COMMENT_LABEL : NO_RUN_LABEL,
      },
      runState: null,
      metaLabel: null,
    };
  }

  return { view: toView(run), runState: run.state, metaLabel: toMetaLabel(run) };
}
