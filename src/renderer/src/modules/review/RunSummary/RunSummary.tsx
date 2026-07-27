import { CollapsibleCard } from '@renderer/components/CollapsibleCard/CollapsibleCard';
import { useRunSummary } from '@renderer/modules/review/RunSummary/useRunSummary';

export interface RunSummaryProps {
  runId: string;
}

const SECTION_ID = 'run-summary';
const HEADING = 'What changed';
const SUBJECT_CLASS = 'text-ink text-sm font-medium leading-relaxed';
const DETAILS_CLASS = 'text-muted text-xs leading-relaxed break-words whitespace-pre-wrap';
const ABSENCE_CLASS = 'text-muted text-xs leading-relaxed';

/**
 * The overview the patch is read against: the agent's statement of what it changed and
 * with what consequences, above the diff because it frames the reading rather than
 * summarising it afterwards.
 */
export function RunSummary({ runId }: RunSummaryProps) {
  const { subject, details, summary, isDefaultOpen, absenceLabel } = useRunSummary({ runId });

  const detailsBlock = details === null ? null : <p className={DETAILS_CLASS}>{details}</p>;

  const body =
    subject === null ? (
      <p className={ABSENCE_CLASS}>{absenceLabel}</p>
    ) : (
      <>
        <p className={SUBJECT_CLASS}>{subject}</p>
        {detailsBlock}
      </>
    );

  return (
    <CollapsibleCard
      sectionId={SECTION_ID}
      heading={HEADING}
      summary={summary}
      isDefaultOpen={isDefaultOpen}
    >
      {body}
    </CollapsibleCard>
  );
}
