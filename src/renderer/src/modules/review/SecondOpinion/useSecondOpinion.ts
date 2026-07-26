import { useCallback, useMemo } from 'react';
import {
  isDissentingVerdict,
  OPINION_VERDICT,
  type OpinionVerdict,
  // Aliased because the component in this folder owns the name `SecondOpinion`.
  type SecondOpinion as SecondOpinionRecord,
} from '@shared/opinion';
import { BADGE_TONE, type BadgeTone } from '@renderer/components/Badge';
import { assertNever } from '@renderer/lib/assertNever';
import { formatDateTime } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { isSecondOpinionRequestable } from '@renderer/modules/review/SecondOpinion/secondOpinionScope';
import { useExecuteRequestSecondOpinion } from '@renderer/modules/runs/useQueryRuns';
import { useRun } from '@renderer/stores/runStore';
import { useSessionStore } from '@renderer/stores/sessionStore';

export interface UseSecondOpinionOptions {
  runId: string;
}

/**
 * A dissent is announced rather than only coloured, so the verdict sentence lives in a
 * live region whose urgency follows the verdict itself.
 */
export const OPINION_LIVE_ROLE = {
  STATUS: 'status',
  ALERT: 'alert',
} as const;

export type OpinionLiveRole = (typeof OPINION_LIVE_ROLE)[keyof typeof OPINION_LIVE_ROLE];

export interface SecondOpinionVerdictView {
  badgeLabel: string;
  tone: BadgeTone;
  /** A full sentence, so the verdict never depends on the badge's colour to be read. */
  statement: string;
  liveRole: OpinionLiveRole;
}

export interface SecondOpinionConcernItem {
  id: string;
  text: string;
}

export interface SecondOpinionModificationView {
  heading: string;
  detail: string;
}

interface UseSecondOpinionResult {
  heading: string;
  /**
   * Says what separates this card from the guardrail card above it: that one holds
   * approval until it is acknowledged, this one holds nothing at all.
   */
  /** Null when the pane is compact; the verdict and its concerns never hide. */
  explanation: string | null;
  /** Null before anyone asked, which is the normal state rather than a failure. */
  verdict: SecondOpinionVerdictView | null;
  /** Non-null only on a disagreement, and it exists to say the disagreement is advice. */
  dissentNote: string | null;
  concernsHeading: string | null;
  concernItems: SecondOpinionConcernItem[];
  /** Non-null when a verdict came back with nothing to raise, which is a real answer. */
  noConcernsLabel: string | null;
  /** Non-null when the reviewer edited the worktree it was told to leave alone. */
  modification: SecondOpinionModificationView | null;
  /** Which model gave the verdict and when, so it can be weighed against its source. */
  sourceLabel: string | null;
  isPoolSpending: boolean;
  /** Non-null while the run has no verdict, so absence reads as an offer, not a fault. */
  absenceLabel: string | null;
  /** Null wherever asking is not on offer; its text is the button's accessible name. */
  requestLabel: string | null;
  /** Says what one costs before it is spent: a slot and a wait, not money. */
  requestCostLabel: string | null;
  isRequestPending: boolean;
  requestPendingLabel: string | null;
  requestErrorMessage: string | null;
  onRequestClick: (() => void) | null;
}

const HEADING = 'Second reading';

/**
 * Deliberately not written like the guardrail card. A flag is a deterministic check
 * that holds approval until it is acknowledged; this is a language model's judgement,
 * and it will sometimes be confidently wrong, so it is given no power over the gate.
 */
const EXPLANATION =
  'A fresh agent read the comment and this patch, without the first agent’s reasoning or summary. It is a reading, not a check: there is nothing to acknowledge, approval is exactly as available as it was, and the decision stays yours.';

const DISSENT_NOTE =
  'This disagreement blocks nothing. A model reading a diff can be confidently wrong, so weigh it against your own reading of the patch rather than deferring to it — and if it is right, revising or rejecting this run is still cheaper than landing it.';

const ADDRESSES_LABEL = 'Addresses the comment';
const ADDRESSES_STATEMENT =
  'The second reader thinks this patch does what the comment asked. That is agreement, not clearance — the patch still needs your eyes.';

const PARTIAL_LABEL = 'Partly addresses it';
const PARTIAL_STATEMENT =
  'The second reader thinks this patch does part of what the comment asked and leaves something undone.';

const MISSES_LABEL = 'Misses the comment';
const MISSES_STATEMENT =
  'The second reader thinks this patch does not do what the comment asked, whatever else it does.';

const HARMFUL_LABEL = 'Actively harmful';
const HARMFUL_STATEMENT =
  'The second reader thinks this patch does something actively wrong — a regression, a broken contract or a leak.';

const CONCERNS_HEADING = 'What it raised';
const NO_CONCERNS_LABEL = 'It raised no concerns of its own.';

/**
 * The reviewer was asked to inspect and change nothing, and a prompt is a request
 * rather than a constraint. An agent that ignored an explicit instruction is worth
 * knowing about regardless of what it wrote, so this is surfaced with real weight.
 */
const MODIFICATION_VIEW: SecondOpinionModificationView = {
  heading: 'The reviewer edited the worktree it was told to leave alone',
  detail:
    'It was asked to read this patch and change nothing, and it changed something anyway. Treat the verdict as coming from an agent that ignored an explicit instruction, and check the revision trail under the patch for what it wrote.',
};

const SOURCE_PREFIX = 'Read by ';
const SOURCE_SEPARATOR = ' · ';
/** The record allows a null model, so the sentence still has to name its source. */
const UNNAMED_MODEL_LABEL = 'a model it did not name';

const ABSENCE_LABEL =
  'No second reading of this patch. That is the ordinary state — one only exists when you ask for it.';

const REQUEST_LABEL = 'Ask a second agent whether this patch does what the comment asked';
const REQUEST_COST_LABEL =
  'It starts one more agent in the free lane, so the cost is a concurrency slot and roughly the wait the original run took — not money.';
const REQUEST_PENDING_LABEL =
  'A fresh agent is reading the comment and the patch. Nothing here is blocked while it works: this run can still be approved, revised or rejected.';

const REQUEST_ERROR_FALLBACK = 'Could not get a second opinion on this run.';

const ID_SEPARATOR = ':';
const NO_CONCERNS = 0;

const NO_CONCERN_ITEMS: SecondOpinionConcernItem[] = [];

/**
 * Exhausted with `assertNever` so a new verdict is a compile error here rather than an
 * unlabelled badge the reader is asked to interpret on trust.
 */
function toVerdictView(verdict: OpinionVerdict): SecondOpinionVerdictView {
  const liveRole = isDissentingVerdict(verdict)
    ? OPINION_LIVE_ROLE.ALERT
    : OPINION_LIVE_ROLE.STATUS;

  switch (verdict) {
    case OPINION_VERDICT.ADDRESSES:
      return {
        badgeLabel: ADDRESSES_LABEL,
        tone: BADGE_TONE.SUCCESS,
        statement: ADDRESSES_STATEMENT,
        liveRole,
      };
    case OPINION_VERDICT.PARTIAL:
      return {
        badgeLabel: PARTIAL_LABEL,
        tone: BADGE_TONE.WARNING,
        statement: PARTIAL_STATEMENT,
        liveRole,
      };
    case OPINION_VERDICT.MISSES:
      return {
        badgeLabel: MISSES_LABEL,
        tone: BADGE_TONE.WARNING,
        statement: MISSES_STATEMENT,
        liveRole,
      };
    case OPINION_VERDICT.HARMFUL:
      return {
        badgeLabel: HARMFUL_LABEL,
        tone: BADGE_TONE.DANGER,
        statement: HARMFUL_STATEMENT,
        liveRole,
      };
    default:
      return assertNever(verdict);
  }
}

function buildSourceLabel(opinion: SecondOpinionRecord): string {
  const modelLabel = isDefined(opinion.model) ? opinion.model : UNNAMED_MODEL_LABEL;
  return `${SOURCE_PREFIX}${modelLabel}${SOURCE_SEPARATOR}${formatDateTime(opinion.reviewedAt)}`;
}

/**
 * The per-run second reading, offered where the approval decision is taken because that
 * is the moment the question arises. Nothing it returns gates anything: a dissenting
 * verdict changes the copy on this card and nothing else in the app.
 */
export function useSecondOpinion({ runId }: UseSecondOpinionOptions): UseSecondOpinionResult {
  const isVerbose = useSessionStore((state) => state.isRunPaneVerbose);
  const run = useRun(runId);
  const { requestSecondOpinion, isRequestSecondOpinionPending, requestSecondOpinionError } =
    useExecuteRequestSecondOpinion();

  // Dismissing a run drops it from the store while its pane is still mounted, so a
  // missing record reads as nothing read yet rather than as a crash.
  const opinion = isDefined(run) ? run.secondOpinion : null;

  const concernItems = useMemo(() => {
    if (!isDefined(opinion)) return NO_CONCERN_ITEMS;
    // A concern carries no id of its own, so its position in the verdict is its identity.
    return opinion.concerns.map((concern, concernIndex) => ({
      id: `${runId}${ID_SEPARATOR}${concernIndex}`,
      text: concern,
    }));
  }, [opinion, runId]);

  const onRequest = useCallback(() => requestSecondOpinion([runId]), [requestSecondOpinion, runId]);

  const isRequestOffered = isDefined(run) && isSecondOpinionRequestable(run);
  const hasConcerns = concernItems.length > NO_CONCERNS;

  const requestErrorMessage = (() => {
    if (!isDefined(requestSecondOpinionError)) return null;
    return isIpcError(requestSecondOpinionError)
      ? requestSecondOpinionError.message
      : REQUEST_ERROR_FALLBACK;
  })();

  return {
    heading: HEADING,
    explanation: isVerbose ? EXPLANATION : null,
    verdict: isDefined(opinion) ? toVerdictView(opinion.verdict) : null,
    dissentNote: isDefined(opinion) && isDissentingVerdict(opinion.verdict) ? DISSENT_NOTE : null,
    concernsHeading: hasConcerns ? CONCERNS_HEADING : null,
    concernItems,
    noConcernsLabel: isDefined(opinion) && !hasConcerns ? NO_CONCERNS_LABEL : null,
    modification: isDefined(opinion) && opinion.didModifyPatch ? MODIFICATION_VIEW : null,
    sourceLabel: isDefined(opinion) ? buildSourceLabel(opinion) : null,
    isPoolSpending: isDefined(opinion) && opinion.isPoolSpending,
    absenceLabel: isDefined(opinion) ? null : ABSENCE_LABEL,
    requestLabel: isRequestOffered ? REQUEST_LABEL : null,
    requestCostLabel:
      isRequestOffered && !isRequestSecondOpinionPending ? REQUEST_COST_LABEL : null,
    isRequestPending: isRequestSecondOpinionPending,
    requestPendingLabel: isRequestSecondOpinionPending ? REQUEST_PENDING_LABEL : null,
    requestErrorMessage,
    onRequestClick: isRequestOffered ? onRequest : null,
  };
}
