import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { joinClassNames } from '@renderer/lib/classNames';
import { useRevisionHistory } from '@renderer/modules/review/RevisionHistory/useRevisionHistory';

export interface RevisionHistoryProps {
  runId: string;
}

const SECTION_LABEL = 'Revision trail';
const LIST_LABEL = 'Revisions, newest first';
const CURRENT_LABEL = 'Current';
const BASE_LABEL = 'Base';

const CONFIRM_HEADING = 'This revert discards your edits';
const CONFIRM_LABEL = 'Discard edits and revert';
const KEEP_EDITS_LABEL = 'Keep the edits';

const COLUMN_CLASS = 'flex flex-col gap-1.5';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const META_CLASS = 'text-muted text-xs leading-relaxed';
const WARNING_CLASS = 'text-warning text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const ACTION_ROW_CLASS = 'flex flex-wrap items-center gap-2';
const CONFIRM_CLASS = 'border-warning/40 bg-warning/10 flex flex-col gap-2 rounded-md border p-2';

/** The list is bounded rather than pushing the diff off screen on a long-lived run. */
const LIST_CLASS = 'flex max-h-64 flex-col gap-1.5 overflow-y-auto';
const ITEM_COMMON_CLASS = 'flex flex-col gap-1.5 rounded-md border p-2';
const REVISION_ITEM_CLASS = joinClassNames(ITEM_COMMON_CLASS, 'border-border bg-surface');
/** Dashed and raised, so the floor of the trail never reads as one more revision. */
const BASE_ITEM_CLASS = joinClassNames(
  ITEM_COMMON_CLASS,
  'border-border-strong bg-surface-raised border-dashed',
);
const ITEM_HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const SUBJECT_CLASS = 'text-ink min-w-0 flex-1 font-mono text-xs break-words';
const REVISION_CLASS = 'text-muted font-mono text-xs';
const COMMITTED_CLASS = 'text-muted text-xs';

/**
 * Sits under the patch because it is about undoing a step you have just read. The
 * commits it lists are an internal artifact that gets squashed at landing, so this is
 * navigation, not a changelog.
 */
export function RevisionHistory({ runId }: RevisionHistoryProps) {
  const {
    heading,
    explanation,
    items,
    statusLabel,
    revisionsErrorMessage,
    isRevertRunPending,
    isDiscardConfirmationOpen,
    discardWarningMessage,
    revertErrorMessage,
    onConfirmDiscardClick,
    onKeepEditsClick,
  } = useRevisionHistory({ runId });

  const entries = items.map((item) => {
    const currentBadge = item.isCurrent ? (
      <Badge tone={BADGE_TONE.ACCENT} isMuted>
        {CURRENT_LABEL}
      </Badge>
    ) : null;

    const baseBadge = item.isBase ? (
      <Badge tone={BADGE_TONE.NEUTRAL} isMuted>
        {BASE_LABEL}
      </Badge>
    ) : null;

    const note = item.note === null ? null : <p className={META_CLASS}>{item.note}</p>;

    const itemClass = item.isBase ? BASE_ITEM_CLASS : REVISION_ITEM_CLASS;

    return (
      <li key={item.revision} className={itemClass}>
        <div className={ITEM_HEADER_CLASS}>
          <span className={SUBJECT_CLASS}>{item.subject}</span>
          {currentBadge}
          {baseBadge}
          <span className={REVISION_CLASS}>{item.shortRevision}</span>
          <span className={COMMITTED_CLASS} title={item.committedTitle}>
            {item.committedLabel}
          </span>
        </div>
        {note}
        <div className={ACTION_ROW_CLASS}>
          <Button
            variant={BUTTON_VARIANT.SECONDARY}
            size={BUTTON_SIZE.SM}
            isDisabled={item.isRevertDisabled}
            onClick={item.onRevertClick}
          >
            {item.revertLabel}
          </Button>
        </div>
      </li>
    );
  });

  const status =
    statusLabel === null ? null : (
      <p role="status" className={META_CLASS}>
        {statusLabel}
      </p>
    );

  const revisionsError =
    revisionsErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {revisionsErrorMessage}
      </p>
    );

  const revertError =
    revertErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {revertErrorMessage}
      </p>
    );

  const discardConfirmation = isDiscardConfirmationOpen ? (
    <div className={CONFIRM_CLASS}>
      <h4 className={HEADING_CLASS}>{CONFIRM_HEADING}</h4>
      <p className={WARNING_CLASS}>{discardWarningMessage}</p>
      <div className={ACTION_ROW_CLASS}>
        <Button
          variant={BUTTON_VARIANT.DANGER}
          size={BUTTON_SIZE.SM}
          isLoading={isRevertRunPending}
          onClick={onConfirmDiscardClick}
        >
          {CONFIRM_LABEL}
        </Button>
        <Button
          variant={BUTTON_VARIANT.SECONDARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isRevertRunPending}
          onClick={onKeepEditsClick}
        >
          {KEEP_EDITS_LABEL}
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.SM}>
      <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
        <h3 className={HEADING_CLASS}>{heading}</h3>
        <p className={META_CLASS}>{explanation}</p>
        {status}
        {revisionsError}
        {discardConfirmation}
        <ol aria-label={LIST_LABEL} className={LIST_CLASS}>
          {entries}
        </ol>
        {revertError}
      </section>
    </Card>
  );
}
