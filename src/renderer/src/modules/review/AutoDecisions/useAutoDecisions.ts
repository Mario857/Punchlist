import { useMemo } from 'react';
import type { AutoDecision } from '@shared/runs';
import { formatDateTime } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { useRun } from '@renderer/stores/runStore';

export interface UseAutoDecisionsOptions {
  runId: string;
}

export interface AutoDecisionAlternativeItem {
  id: string;
  label: string;
}

export interface AutoDecisionItem {
  id: string;
  /** What the agent halted on, in its own words. */
  question: string;
  /** Reads as "Auto-answered: chose …", so what was taken is never a bare quotation. */
  chosenLabel: string;
  /**
   * What was passed over. Empty only in the degenerate case, since auto mode declines
   * to answer a question offering fewer than two options.
   */
  alternativeItems: AutoDecisionAlternativeItem[];
  /** Non-null whenever something was passed over, so the heading is not shown alone. */
  alternativesHeading: string | null;
  decidedLabel: string;
}

interface UseAutoDecisionsResult {
  hasAutoDecisions: boolean;
  heading: string;
  explanation: string;
  /** Says the run is still yours to change, because that is what makes deferral honest. */
  reversibilityNote: string;
  countLabel: string;
  items: AutoDecisionItem[];
}

const HEADING = 'Answered without you';

/**
 * Deliberately neither error nor warning copy. Every entry here is a judgement auto mode
 * made on the user's behalf, which is worth re-reading precisely because it was not
 * wrong enough to stop for.
 */
const EXPLANATION =
  'Auto mode answered these blocking questions so the run could continue. Nothing here went wrong — they are the calls made for you, surfaced now rather than after the patch lands.';

const REVERSIBILITY_NOTE =
  'Disagreeing with one costs nothing yet: revise this run with a follow-up, or revert it to an earlier revision, before you approve anything.';

const ALTERNATIVES_HEADING = 'Passed over';

const CHOSEN_PREFIX = 'Auto-answered: chose ';
const DECIDED_PREFIX = 'Decided ';

const SINGLE_DECISION_COUNT_LABEL = '1 decision was made for you on this run.';
const COUNT_LABEL_SUFFIX = ' decisions were made for you on this run.';

const ID_SEPARATOR = ':';

const NO_AUTO_DECISIONS = 0;
const SINGLE_AUTO_DECISION = 1;
const NO_ALTERNATIVES = 0;

const NO_AUTO_DECISION_RECORDS: readonly AutoDecision[] = [];

export function useAutoDecisions({ runId }: UseAutoDecisionsOptions): UseAutoDecisionsResult {
  const run = useRun(runId);

  // Dismissing a run drops it from the store while its pane is still mounted, so a
  // missing record reads as nothing decided rather than as a crash.
  const autoDecisions = isDefined(run) ? run.autoDecisions : NO_AUTO_DECISION_RECORDS;

  const items = useMemo(
    () =>
      autoDecisions.map((decision, decisionIndex) => {
        // An auto-decision carries no id of its own and the list is only ever appended
        // to, so its position in the run is a stable identity.
        const id = `${runId}${ID_SEPARATOR}${decisionIndex}`;
        const alternativeItems = decision.alternatives.map((alternative, alternativeIndex) => ({
          id: `${id}${ID_SEPARATOR}${alternativeIndex}`,
          label: alternative,
        }));

        return {
          id,
          question: decision.question,
          chosenLabel: `${CHOSEN_PREFIX}${decision.chosenOption}`,
          alternativeItems,
          alternativesHeading:
            alternativeItems.length === NO_ALTERNATIVES ? null : ALTERNATIVES_HEADING,
          decidedLabel: `${DECIDED_PREFIX}${formatDateTime(decision.decidedAt)}`,
        };
      }),
    [autoDecisions, runId],
  );

  const countLabel =
    items.length === SINGLE_AUTO_DECISION
      ? SINGLE_DECISION_COUNT_LABEL
      : `${items.length}${COUNT_LABEL_SUFFIX}`;

  return {
    hasAutoDecisions: items.length > NO_AUTO_DECISIONS,
    heading: HEADING,
    explanation: EXPLANATION,
    reversibilityNote: REVERSIBILITY_NOTE,
    countLabel,
    items,
  };
}
