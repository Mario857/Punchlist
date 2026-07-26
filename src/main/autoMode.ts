import { hasChoosableOptions } from '@main/decision';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import type { AgentDecision, AutoDecision, RunRecord } from '@shared/runs';

// Auto mode takes the recommended path on decisions that would otherwise block, and its
// boundary is exactly the sandbox boundary: it answers a halted agent and nothing else.
// Approving a diff, anything outside the sandbox, crossing into the paid lane, and
// force-removing a dirty worktree stay human actions, so there is no helper here for any
// of them.

/**
 * Session state, not a setting. The toggle is off on every app start so it cannot be
 * left on by accident from a previous session, which is why it lives as a module-level
 * flag rather than in `AppSettings` — persisting it would defeat the point, so a later
 * change moving it into the store is a regression, not a fix.
 */
let isEnabled = false;

/**
 * Auto-answers compound: each one is a small judgment made without the user, and a
 * handful in a row is a meaningful drift from what they would have chosen. Past this
 * many on a single run, it parks for a human regardless of the toggle. The count is read
 * off the run's own recorded auto-decisions, so it survives a restart and a retry of the
 * same record rather than resetting with the process.
 */
export const MAX_AUTO_ANSWERS_PER_RUN = 3;

const NO_OPTION_MESSAGE =
  'An auto-decision was built from a decision with no options, which canAutoAnswer rules out.';

export function isAutoModeEnabled(): boolean {
  return isEnabled;
}

/** Returns the state it settled on, so the caller reports what is true rather than what it asked for. */
export function setAutoModeEnabled(nextIsEnabled: boolean): boolean {
  isEnabled = nextIsEnabled;
  return isEnabled;
}

/**
 * Fewer than two options is nothing to choose between — `hasChoosableOptions` is the
 * single source of that rule — so the run parks in `needsDecision` as normal rather than
 * "picking" the only thing on offer and calling it a decision.
 */
export function canAutoAnswer(run: RunRecord, decision: AgentDecision): boolean {
  if (!isEnabled) return false;
  if (!hasChoosableOptions(decision)) return false;
  return run.autoDecisions.length < MAX_AUTO_ANSWERS_PER_RUN;
}

/**
 * Auto mode defers decisions rather than hiding them, so what was passed over is recorded
 * beside what was taken: without the alternatives, review can only show that something
 * was decided, never that the wrong thing was.
 *
 * Only meaningful after `canAutoAnswer` returned true, which is what guarantees an option
 * exists. Calling it otherwise is a bug in the caller, so it fails loudly.
 */
export function toAutoDecision(decision: AgentDecision): AutoDecision {
  // The agent is instructed to order `options` best-first, which is the whole reason
  // taking the head is a recommendation rather than an arbitrary pick.
  const [chosenOption, ...alternatives] = decision.options;
  if (chosenOption === undefined) {
    throw new AppError(APP_ERROR_KIND.UNKNOWN, NO_OPTION_MESSAGE);
  }

  return {
    question: decision.question,
    chosenOption,
    alternatives,
    decidedAt: new Date().toISOString(),
  };
}
