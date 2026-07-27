import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { useAutoDecisions } from '@renderer/modules/review/AutoDecisions/useAutoDecisions';

export interface AutoDecisionsProps {
  runId: string;
}

const CARD_COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-xs font-semibold tracking-wide uppercase';
const SECTION_LABEL = 'Auto-answered decisions';
const LIST_LABEL = 'Decisions auto mode took on this run';
const AUTO_ANSWERED_BADGE_LABEL = 'Auto';

const COLUMN_CLASS = 'flex flex-col gap-1.5';
const META_CLASS = 'text-muted text-xs leading-relaxed';
/** Accent rather than warning: a deferred decision is a thing to read, not a fault. */
const COUNT_CLASS = 'text-accent text-xs leading-relaxed';
const LIST_CLASS = 'flex flex-col gap-2';
const ITEM_CLASS = 'border-info/40 bg-info/10 flex flex-col gap-1.5 rounded-md border p-2';
const ITEM_HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const QUESTION_CLASS = 'text-ink min-w-0 flex-1 text-xs font-semibold';
const DECIDED_CLASS = 'text-muted text-xs';
const CHOSEN_CLASS = 'text-ink text-xs font-medium leading-relaxed';
const ALTERNATIVES_HEADING_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const ALTERNATIVES_LIST_CLASS = 'text-muted flex flex-col gap-0.5 text-xs leading-relaxed';

/**
 * Sits beside the diff because that is the moment a wrong call is still cheap: auto mode
 * defers its decisions rather than hiding them, and this is where the deferral is paid
 * back. Renders nothing when the run has none, so an empty card never claims otherwise.
 */
export function AutoDecisions({ runId }: AutoDecisionsProps) {
  const { hasAutoDecisions, heading, explanation, reversibilityNote, countLabel, items } =
    useAutoDecisions({ runId });

  if (!hasAutoDecisions) return null;

  const entries = items.map((item) => {
    const alternativeRows = item.alternativeItems.map((alternative) => (
      <li key={alternative.id}>{alternative.label}</li>
    ));

    const alternatives =
      item.alternativesHeading === null ? null : (
        <>
          <p className={ALTERNATIVES_HEADING_CLASS}>{item.alternativesHeading}</p>
          <ul className={ALTERNATIVES_LIST_CLASS}>{alternativeRows}</ul>
        </>
      );

    return (
      <li key={item.id} className={ITEM_CLASS}>
        <div className={ITEM_HEADER_CLASS}>
          <h4 className={QUESTION_CLASS}>{item.question}</h4>
          <Badge tone={BADGE_TONE.INFO}>{AUTO_ANSWERED_BADGE_LABEL}</Badge>
          <span className={DECIDED_CLASS}>{item.decidedLabel}</span>
        </div>
        <p className={CHOSEN_CLASS}>{item.chosenLabel}</p>
        {alternatives}
      </li>
    );
  });

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.SM} className={CARD_COLUMN_CLASS}>
      <h3 className={HEADING_CLASS}>{heading}</h3>
      <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
        <p className={META_CLASS}>{explanation}</p>
        <p role="status" className={COUNT_CLASS}>
          {countLabel}
        </p>
        <ul aria-label={LIST_LABEL} className={LIST_CLASS}>
          {entries}
        </ul>
        <p className={META_CLASS}>{reversibilityNote}</p>
      </section>
    </Card>
  );
}
