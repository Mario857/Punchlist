import { hasUnacknowledgedFlags } from '@shared/guardrails';
import { isDissentingVerdict } from '@shared/opinion';
import type { AgentDecision, RunRecord } from '@shared/runs';
import {
  AUX_SECTION,
  type AuxSection,
} from '@renderer/modules/review/RunPane/components/RunAuxSections/useRunAuxSections';
import { FAILURE_REASON, RUN_STATE, type RunState } from '@shared/runState';
import { assertNever } from '@renderer/lib/assertNever';
import { formatDuration } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { useRunForComment } from '@renderer/stores/runStore';
import { useSessionStore } from '@renderer/stores/sessionStore';
import { TIER_LABEL } from '@renderer/modules/comments/tierPresentation';

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
      /**
       * True while the patch carries any flag at all, acknowledged or not: an accepted
       * flag stays on screen because the record of what was accepted is the point.
       */
      hasGuardrailFlags: boolean;
      /**
       * Where the flag card renders. A flag still waiting on you gates the approval,
       * so it belongs above the diff; once every flag is acknowledged the card is a
       * record rather than a gate, and a record does not get to stand between you and
       * the patch.
       */
      hasUnacknowledgedGuardrailFlags: boolean;
      /**
       * The occasional surfaces this run can offer behind the aux row, so the pane's
       * spine stays comment → diff → decision.
       */
      auxSections: readonly AuxSection[];
      /**
       * A dissenting verdict renders outright instead of behind the row: a reader who
       * disagrees with the patch is the one voice that must not need a click to hear.
       */
      isSecondOpinionPinned: boolean;
      /**
       * Where a second reading is worth a card: `ready` and `approved` can still ask
       * for one, and a decided or landed run keeps the verdict it already has, since
       * that verdict is part of the record of how the patch was reviewed. Revising has
       * nothing settled to have an opinion about.
       */
      isSecondOpinionAvailable: boolean;
      /** Non-null only while revising, which keeps the diff on screen but dimmed. */
      revisionProgressLabel: string | null;
      /**
       * Hand edits and targeted edits are offered in `ready` only, and for the same
       * reason the follow-up is: revising means the agent holds the run, and an
       * approved or applied patch is no longer a candidate to rewrite.
       */
      isPatchEditable: boolean;
      /**
       * The whole-patch follow-up is offered in `ready` only: revising means the agent
       * already has the run, and an applied patch is no longer a candidate.
       */
      isFollowUpAvailable: boolean;
      /**
       * The trail is offered where rewinding it still means something: not while the
       * agent holds the run, and not once the patch has landed, since the revisions are
       * squashed away at that point and resetting the worktree would change nothing on
       * the branch.
       */
      isRevisionHistoryAvailable: boolean;
      /**
       * The approve/reject surface, offered wherever a review decision is still open:
       * `ready` decides, `approved` and `rejected` show what was decided and offer the
       * way back. Revising has nothing settled to decide on and `applied` is history.
       */
      isReviewDecisionAvailable: boolean;
    }
  | { kind: typeof RUN_PANE_VIEW_KIND.NO_ACTION_NEEDED; heading: string; explanation: string }
  | {
      kind: typeof RUN_PANE_VIEW_KIND.FAILURE;
      /** Carried so the failure surface can offer escalation on this exact run. */
      runId: string;
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
  /** Names the state the button moves to, so it reads as an action rather than a status. */
  verbosityLabel: string;
  isVerbose: boolean;
  onToggleVerbosityClick: () => void;
  /** Null before a run exists, which is what suppresses the header badge. */
  runState: RunState | null;
  /** Null before a run exists, rather than an empty line reading "--". */
  metaLabel: string | null;
}

const SHOW_EXPLANATIONS_LABEL = 'Explain';
const HIDE_EXPLANATIONS_LABEL = 'Less';
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
  'It started, did work, and returned an error. The reason is in the transcript rather than in Punchlist.';

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

const POOL_SPENDING_LABEL = 'Spent the included pool';

const REVISING_LABEL = 'Revising the patch…';
const REVISION_LABEL_PREFIX = 'Revision ';
const META_SEPARATOR = ' · ';

/** A failure is diagnosed from the end of the output, not from the whole log. */
const FAILURE_TRANSCRIPT_TAIL_LINE_COUNT = 40;
const NO_REVISIONS = 0;
const NO_GUARDRAIL_FLAGS = 0;
const NO_AUTO_DECISIONS = 0;
/** Placeholder on construction; `toAuxEnrichedView` fills the real list in. */
const NO_AUX_SECTIONS: readonly AuxSection[] = [];

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

function toAuxEnrichedView(view: RunPaneView, run: RunRecord): RunPaneView {
  if (view.kind !== RUN_PANE_VIEW_KIND.DIFF) return view;

  const opinion = run.secondOpinion;
  const isSecondOpinionPinned = isDefined(opinion) && isDissentingVerdict(opinion.verdict);

  const auxSections: AuxSection[] = [];
  if (view.isFollowUpAvailable) auxSections.push(AUX_SECTION.FOLLOW_UP);
  if (view.isSecondOpinionAvailable && !isSecondOpinionPinned) {
    auxSections.push(AUX_SECTION.SECOND_OPINION);
  }
  if (view.isRevisionHistoryAvailable) auxSections.push(AUX_SECTION.REVISION_HISTORY);
  if (view.hasGuardrailFlags && !view.hasUnacknowledgedGuardrailFlags) {
    auxSections.push(AUX_SECTION.ACKNOWLEDGED_FLAGS);
  }
  if (run.autoDecisions.length > NO_AUTO_DECISIONS) auxSections.push(AUX_SECTION.AUTO_DECISIONS);

  return { ...view, auxSections, isSecondOpinionPinned };
}

function toView(run: RunRecord): RunPaneView {
  const hasGuardrailFlags = run.guardrailFlags.length > NO_GUARDRAIL_FLAGS;
  const hasUnacknowledgedGuardrailFlags = hasUnacknowledgedFlags(
    run.guardrailFlags,
    run.acknowledgedGuardrailIds,
  );
  const hasSecondOpinion = isDefined(run.secondOpinion);

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
        hasGuardrailFlags,
        hasUnacknowledgedGuardrailFlags,
        auxSections: NO_AUX_SECTIONS,
        isSecondOpinionPinned: false,
        // The patch is moving, and a verdict is about the patch that was read.
        isSecondOpinionAvailable: false,
        revisionProgressLabel: toRevisionProgressLabel(run),
        isPatchEditable: false,
        isFollowUpAvailable: false,
        isRevisionHistoryAvailable: false,
        isReviewDecisionAvailable: false,
      };
    case RUN_STATE.READY:
      return {
        kind: RUN_PANE_VIEW_KIND.DIFF,
        runId: run.id,
        hasGuardrailFlags,
        hasUnacknowledgedGuardrailFlags,
        auxSections: NO_AUX_SECTIONS,
        isSecondOpinionPinned: false,
        isSecondOpinionAvailable: true,
        revisionProgressLabel: null,
        isPatchEditable: true,
        isFollowUpAvailable: true,
        isRevisionHistoryAvailable: true,
        isReviewDecisionAvailable: true,
      };
    // Approval is not the point of no return — landing is — so an approved patch can
    // still be rewound, which main handles by putting the run back to ready.
    case RUN_STATE.APPROVED:
      return {
        kind: RUN_PANE_VIEW_KIND.DIFF,
        runId: run.id,
        hasGuardrailFlags,
        hasUnacknowledgedGuardrailFlags,
        auxSections: NO_AUX_SECTIONS,
        isSecondOpinionPinned: false,
        // Approval is revocable up to the landing gate, so a second reading can still
        // change the outcome here.
        isSecondOpinionAvailable: true,
        revisionProgressLabel: null,
        isPatchEditable: false,
        isFollowUpAvailable: false,
        isRevisionHistoryAvailable: true,
        isReviewDecisionAvailable: true,
      };
    // Rejected keeps its diff readable: the record of what was turned down is the
    // point, and the run can still be reopened for review. The trail is what reopens
    // it — a revert re-reads the patch and settles the run back in `ready` — so it
    // stays on offer here even though a landed run's does not.
    case RUN_STATE.REJECTED:
      return {
        kind: RUN_PANE_VIEW_KIND.DIFF,
        runId: run.id,
        hasGuardrailFlags,
        hasUnacknowledgedGuardrailFlags,
        auxSections: NO_AUX_SECTIONS,
        isSecondOpinionPinned: false,
        // Kept where one exists, dropped where none does: a turned-down run is not
        // worth a fresh agent, but the reading that informed the rejection is history
        // worth keeping on screen.
        isSecondOpinionAvailable: hasSecondOpinion,
        revisionProgressLabel: null,
        isPatchEditable: false,
        isFollowUpAvailable: false,
        isRevisionHistoryAvailable: true,
        isReviewDecisionAvailable: true,
      };
    case RUN_STATE.APPLIED:
      return {
        kind: RUN_PANE_VIEW_KIND.DIFF,
        runId: run.id,
        hasGuardrailFlags,
        hasUnacknowledgedGuardrailFlags,
        auxSections: NO_AUX_SECTIONS,
        isSecondOpinionPinned: false,
        // Landed: the verdict stays readable as part of the record, and there is
        // nothing left for a new one to change.
        isSecondOpinionAvailable: hasSecondOpinion,
        revisionProgressLabel: null,
        isPatchEditable: false,
        isFollowUpAvailable: false,
        isRevisionHistoryAvailable: false,
        isReviewDecisionAvailable: false,
      };
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
        runId: run.id,
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
  const parts: string[] = [TIER_LABEL[run.tier]];
  if (isDefined(run.model)) parts.push(run.model);
  // Each run records whether it drew down the pool, so spend stays attributable to a
  // specific run after the fact rather than only to a day's usage total.
  if (run.isPoolSpending) parts.push(POOL_SPENDING_LABEL);
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
  const isVerbose = useSessionStore((state) => state.isRunPaneVerbose);
  const setIsRunPaneVerbose = useSessionStore((state) => state.setIsRunPaneVerbose);

  const verbosity = {
    isVerbose,
    verbosityLabel: isVerbose ? HIDE_EXPLANATIONS_LABEL : SHOW_EXPLANATIONS_LABEL,
    onToggleVerbosityClick: () => setIsRunPaneVerbose(!isVerbose),
  };

  if (!isDefined(run)) {
    return {
      view: {
        kind: RUN_PANE_VIEW_KIND.NO_RUN,
        emptyStateLabel: commentId === null ? NO_COMMENT_LABEL : NO_RUN_LABEL,
      },
      runState: null,
      metaLabel: null,
      ...verbosity,
    };
  }

  return {
    view: toAuxEnrichedView(toView(run), run),
    runState: run.state,
    metaLabel: toMetaLabel(run),
    ...verbosity,
  };
}
