import type { RunRecord } from '@shared/runs';
import { RUN_STATE } from '@shared/runState';
import { assertNever } from '@renderer/lib/assertNever';
import { isDefined } from '@renderer/lib/guards';

export interface SecondOpinionScope {
  /** Runs a batch request would actually start an agent for. */
  requestableRunIds: string[];
  /**
   * Runs in scope whose current patch already carries a verdict. Counted rather than
   * dropped, because a batch that quietly does less than its label says is worse than
   * one that explains what it left out.
   */
  alreadyReviewedCount: number;
}

const NO_RUNS_REVIEWED = 0;
const SINGLE_RUN = 1;

/**
 * Where a second reading can still change something: the patch has settled and the
 * decision on it is open. Exhausted with `assertNever` so a new run state has to
 * answer this question rather than falling silently into "no".
 */
function isPatchOpenForReview(run: RunRecord): boolean {
  switch (run.state) {
    // Approval is revocable right up to the landing gate, so a second reading of an
    // approved patch is still worth an agent; an applied one is history.
    case RUN_STATE.READY:
    case RUN_STATE.APPROVED:
      return true;
    case RUN_STATE.QUEUED:
    case RUN_STATE.RUNNING:
    case RUN_STATE.NEEDS_DECISION:
    case RUN_STATE.REVISING:
    case RUN_STATE.REJECTED:
    case RUN_STATE.APPLIED:
    case RUN_STATE.NO_ACTION_NEEDED:
    case RUN_STATE.FAILED:
      return false;
    default:
      return assertNever(run.state);
  }
}

/**
 * A verdict is about the patch that was read, and a revision clears it, so a run that
 * already carries one has a current reading: asking again would spend a second agent
 * to learn the same thing.
 */
export function isSecondOpinionRequestable(run: RunRecord): boolean {
  return isPatchOpenForReview(run) && !isDefined(run.secondOpinion);
}

export function toSecondOpinionScope(runs: readonly RunRecord[]): SecondOpinionScope {
  const requestableRunIds: string[] = [];
  let alreadyReviewedCount = NO_RUNS_REVIEWED;

  for (const run of runs) {
    if (!isPatchOpenForReview(run)) continue;
    if (isDefined(run.secondOpinion)) {
      alreadyReviewedCount += SINGLE_RUN;
      continue;
    }
    requestableRunIds.push(run.id);
  }

  return { requestableRunIds, alreadyReviewedCount };
}
