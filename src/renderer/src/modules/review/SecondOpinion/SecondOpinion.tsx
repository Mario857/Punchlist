import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { CollapsibleCard } from '@renderer/components/CollapsibleCard/CollapsibleCard';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { useSecondOpinion } from '@renderer/modules/review/SecondOpinion/useSecondOpinion';

export interface SecondOpinionProps {
  runId: string;
}

const SECTION_ID = 'second-opinion';
const SECTION_LABEL = 'Second opinion';
const CONCERNS_LIST_LABEL = 'Concerns raised by the second reader';

const POOL_SPENDING_LABEL = 'Spent the included pool';
const POOL_SPENDING_TITLE =
  'This reading came from a model that draws down the included pool rather than the free lane, so weigh the disagreement against its source';

/** One step up from a badge glyph: the heading mark for a finding worth stopping on. */
const MODIFICATION_ICON_SIZE = 14;

const COLUMN_CLASS = 'flex flex-col gap-1.5';
const HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const STATEMENT_CLASS = 'text-ink text-xs leading-relaxed';
const META_CLASS = 'text-muted text-xs leading-relaxed';
const SOURCE_CLASS = 'text-muted text-xs';
/** Warning rather than danger: a dissent is worth slowing down for, never a failure. */
const DISSENT_CLASS = 'text-warning text-xs leading-relaxed';
const CONCERNS_HEADING_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const CONCERNS_LIST_CLASS = 'flex flex-col gap-1';
const CONCERN_ITEM_CLASS =
  'border-border bg-surface text-ink rounded-md border p-2 text-xs leading-relaxed';
const MODIFICATION_CLASS =
  'border-warning/40 bg-warning/10 flex flex-col gap-1 rounded-md border p-2';
const MODIFICATION_HEADING_CLASS = 'text-warning flex items-center gap-1.5 text-xs font-semibold';
const MODIFICATION_DETAIL_CLASS = 'text-ink text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

/**
 * Sits with the guardrail flags and the auto-decisions, in the family of things worth
 * knowing before you start reading — but it is the one card in that family that gates
 * nothing, and the copy says so rather than leaving the two to look alike.
 */
export function SecondOpinion({ runId }: SecondOpinionProps) {
  const {
    heading,
    summary,
    isDefaultOpen,
    explanation,
    verdict,
    dissentNote,
    concernsHeading,
    concernItems,
    noConcernsLabel,
    modification,
    sourceLabel,
    isPoolSpending,
    absenceLabel,
    requestLabel,
    requestCostLabel,
    isRequestPending,
    requestPendingLabel,
    requestErrorMessage,
    onRequestClick,
  } = useSecondOpinion({ runId });

  const verdictBadge =
    verdict === null ? null : <Badge tone={verdict.tone}>{verdict.badgeLabel}</Badge>;

  // Muted beside the verdict: where the reading came from qualifies it rather than
  // competing with it.
  const poolSpendingBadge = isPoolSpending ? (
    <Badge tone={BADGE_TONE.ACCENT} isMuted title={POOL_SPENDING_TITLE}>
      {POOL_SPENDING_LABEL}
    </Badge>
  ) : null;

  const verdictStatement =
    verdict === null ? null : (
      <p role={verdict.liveRole} className={STATEMENT_CLASS}>
        {verdict.statement}
      </p>
    );

  const modificationNotice =
    modification === null ? null : (
      <div role="alert" className={MODIFICATION_CLASS}>
        <h4 className={MODIFICATION_HEADING_CLASS}>
          <AlertTriangleIcon size={MODIFICATION_ICON_SIZE} />
          {modification.heading}
        </h4>
        <p className={MODIFICATION_DETAIL_CLASS}>{modification.detail}</p>
      </div>
    );

  const concernRows = concernItems.map((item) => (
    <li key={item.id} className={CONCERN_ITEM_CLASS}>
      {item.text}
    </li>
  ));

  const concerns =
    concernsHeading === null ? null : (
      <>
        <p className={CONCERNS_HEADING_CLASS}>{concernsHeading}</p>
        <ul aria-label={CONCERNS_LIST_LABEL} className={CONCERNS_LIST_CLASS}>
          {concernRows}
        </ul>
      </>
    );

  const noConcerns =
    noConcernsLabel === null ? null : <p className={META_CLASS}>{noConcernsLabel}</p>;

  const dissent = dissentNote === null ? null : <p className={DISSENT_CLASS}>{dissentNote}</p>;

  const source = sourceLabel === null ? null : <p className={SOURCE_CLASS}>{sourceLabel}</p>;

  const absence = absenceLabel === null ? null : <p className={META_CLASS}>{absenceLabel}</p>;

  // The label is the button's visible text, so the accessible name says what asking
  // does rather than reading "Ask".
  const requestButton =
    requestLabel === null ? null : (
      <Button
        variant={BUTTON_VARIANT.SECONDARY}
        size={BUTTON_SIZE.SM}
        isLoading={isRequestPending}
        onClick={onRequestClick ?? undefined}
      >
        {requestLabel}
      </Button>
    );

  const requestCost =
    requestCostLabel === null ? null : <p className={META_CLASS}>{requestCostLabel}</p>;

  const requestPending =
    requestPendingLabel === null ? null : (
      <p role="status" className={META_CLASS}>
        {requestPendingLabel}
      </p>
    );

  const requestError =
    requestErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {requestErrorMessage}
      </p>
    );

  const explanationLine = explanation === null ? null : <p className={META_CLASS}>{explanation}</p>;

  // In the header rather than the body: a verdict is the one thing worth reading off a
  // closed section, and the summary line beside it cannot carry a colour.
  const headerBadges = (
    <span className={HEADER_CLASS}>
      {verdictBadge}
      {poolSpendingBadge}
    </span>
  );

  return (
    <CollapsibleCard
      sectionId={SECTION_ID}
      heading={heading}
      summary={summary}
      isDefaultOpen={isDefaultOpen}
      headerAccessory={headerBadges}
    >
      <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
        {verdictStatement}
        {modificationNotice}
        {concerns}
        {noConcerns}
        {dissent}
        {explanationLine}
        {source}
        {absence}
        {requestButton}
        {requestCost}
        {requestPending}
        {requestError}
      </section>
    </CollapsibleCard>
  );
}
