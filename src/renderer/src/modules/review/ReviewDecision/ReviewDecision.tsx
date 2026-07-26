import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { CollapsibleCard } from '@renderer/components/CollapsibleCard/CollapsibleCard';
import { useReviewDecision } from '@renderer/modules/review/ReviewDecision/useReviewDecision';

export interface ReviewDecisionProps {
  runId: string;
}

const SECTION_ID = 'review-decision';
const STATUS_CLASS = 'text-ink text-xs leading-relaxed';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const HINT_CLASS = 'text-muted text-xs leading-relaxed';
const BLOCKED_CLASS = 'text-warning text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const ACTION_ROW_CLASS = 'flex flex-wrap items-center gap-2';

/**
 * The review gate for one run. Rejecting is not a danger action: it keeps the record
 * and the worktree and can be reopened, so it is the secondary button rather than the
 * red one — the destructive control in this app is Dismiss.
 */
export function ReviewDecision({ runId }: ReviewDecisionProps) {
  const {
    heading,
    summary,
    isDefaultOpen,
    statusLabel,
    explanation,
    approveLabel,
    isApproveDisabled,
    approveBlockedMessage,
    rejectLabel,
    reopenHint,
    isDecisionPending,
    errorMessage,
    onApproveClick,
    onRejectClick,
  } = useReviewDecision({ runId });

  const approveButton =
    approveLabel === null ? null : (
      <Button
        variant={BUTTON_VARIANT.PRIMARY}
        size={BUTTON_SIZE.SM}
        isDisabled={isApproveDisabled}
        isLoading={isDecisionPending}
        onClick={onApproveClick ?? undefined}
      >
        {approveLabel}
      </Button>
    );

  const rejectButton =
    rejectLabel === null ? null : (
      <Button
        variant={BUTTON_VARIANT.SECONDARY}
        size={BUTTON_SIZE.SM}
        isDisabled={isDecisionPending}
        onClick={onRejectClick ?? undefined}
      >
        {rejectLabel}
      </Button>
    );

  // Beside the buttons rather than as a tooltip: a disabled button cannot be focused,
  // so a hover-only explanation would be unreachable from the keyboard. The flag card
  // above already announces the outstanding count, so this one is not a live region too.
  const approveBlocked =
    approveBlockedMessage === null ? null : (
      <p className={BLOCKED_CLASS}>{approveBlockedMessage}</p>
    );

  const reopen = reopenHint === null ? null : <p className={HINT_CLASS}>{reopenHint}</p>;

  const error =
    errorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {errorMessage}
      </p>
    );

  const explanationLine =
    explanation === null ? null : <p className={EXPLANATION_CLASS}>{explanation}</p>;

  return (
    <CollapsibleCard
      sectionId={SECTION_ID}
      heading={heading}
      summary={summary}
      isDefaultOpen={isDefaultOpen}
    >
      <p role="status" className={STATUS_CLASS}>
        {statusLabel}
      </p>
      {explanationLine}
      <div className={ACTION_ROW_CLASS}>
        {approveButton}
        {rejectButton}
      </div>
      {approveBlocked}
      {reopen}
      {error}
    </CollapsibleCard>
  );
}
