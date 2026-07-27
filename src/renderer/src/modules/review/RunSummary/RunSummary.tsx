import { useRunSummary } from '@renderer/modules/review/RunSummary/useRunSummary';

export interface RunSummaryProps {
  runId: string;
}

const SUBJECT_CLASS = 'text-ink text-sm font-medium leading-relaxed';
const DETAILS_CLASS = 'text-muted text-xs leading-relaxed break-words whitespace-pre-wrap';

/**
 * The overview the patch is read against, as plain prose rather than a card: it is
 * part of the reading, not a section to manage. An absent summary renders nothing —
 * the diff below is the record either way.
 */
export function RunSummary({ runId }: RunSummaryProps) {
  const { subject, details } = useRunSummary({ runId });

  if (subject === null) return null;

  const detailsBlock = details === null ? null : <p className={DETAILS_CLASS}>{details}</p>;

  return (
    <div className="flex flex-col gap-1">
      <p className={SUBJECT_CLASS}>{subject}</p>
      {detailsBlock}
    </div>
  );
}
