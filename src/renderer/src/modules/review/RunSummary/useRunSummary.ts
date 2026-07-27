import { useRun } from '@renderer/stores/runStore';

export interface UseRunSummaryParams {
  runId: string;
}

interface UseRunSummaryResult {
  /** Null when the agent wrote no summary or wrote one that failed to parse. */
  subject: string | null;
  details: string | null;
}

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
  };
}
