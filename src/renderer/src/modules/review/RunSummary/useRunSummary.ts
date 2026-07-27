import { useRun } from '@renderer/stores/runStore';

export interface UseRunSummaryParams {
  runId: string;
}

interface UseRunSummaryResult {
  /** Null when the agent wrote no summary or wrote one that failed to parse. */
  subject: string | null;
  details: string | null;
  summary: string;
  isDefaultOpen: boolean;
  absenceLabel: string;
}

const ABSENCE_LABEL =
  'The agent wrote no summary for this change. The transcript and the diff are the record.';
const NO_SUMMARY_HEADER_LABEL = 'No summary was written';

/**
 * The agent's own account of the change — what it did and why, written by the one
 * author who knows. It was already collected for the commit message at landing; this
 * puts it where the review starts instead of only where it ends.
 */
export function useRunSummary({ runId }: UseRunSummaryParams): UseRunSummaryResult {
  const run = useRun(runId);
  const summary = run?.summary ?? null;

  return {
    subject: summary?.subject ?? null,
    details: summary?.details ?? null,
    summary: summary?.subject ?? NO_SUMMARY_HEADER_LABEL,
    // Open when there is something to read: the overview is the entry point of the
    // review, but an absence note is not worth the space it would hold open.
    isDefaultOpen: summary !== null,
    absenceLabel: ABSENCE_LABEL,
  };
}
