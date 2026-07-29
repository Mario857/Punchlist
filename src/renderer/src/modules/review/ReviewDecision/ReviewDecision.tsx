import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { useReviewDecision } from '@renderer/modules/review/ReviewDecision/useReviewDecision';

export interface ReviewDecisionProps {
  runId: string;
}

const SECTION_LABEL = 'Review decision';
const ROW_CLASS = 'flex flex-wrap items-center gap-2';
const STATUS_CLASS = 'text-muted text-xs leading-relaxed';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const HINT_CLASS = 'text-muted text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

/**
 * The review gate for one run, as one slim row rather than a card: the decision
 * repeats on every run a review walks through, so its chrome is paid dozens of times
 * per PR and the buttons already say everything the heading said. Rejecting is not a
 * danger action — the record survives and the comment can be run again — so it is the
 * secondary button rather than the red one; the destructive control here is Dismiss.
 */
export function ReviewDecision({ runId }: ReviewDecisionProps) {
  const {
    statusLabel,
    explanation,
    approveLabel,
    isApproveDisabled,
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

  // The status only earns a line when there is no button carrying the same words —
  // approved and landed states, where what happened is the whole message.
  const status =
    approveButton === null && rejectButton === null ? (
      <p role="status" className={STATUS_CLASS}>
        {statusLabel}
      </p>
    ) : null;

  const statusBesideActions =
    approveButton !== null || rejectButton !== null ? (
      <span className={STATUS_CLASS}>{statusLabel}</span>
    ) : null;

  const explanationLine =
    explanation === null ? null : <p className={EXPLANATION_CLASS}>{explanation}</p>;

  const reopen = reopenHint === null ? null : <p className={HINT_CLASS}>{reopenHint}</p>;

  const error =
    errorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {errorMessage}
      </p>
    );

  return (
    <section aria-label={SECTION_LABEL} className="flex flex-col gap-1.5">
      <div className={ROW_CLASS}>
        {approveButton}
        {rejectButton}
        {statusBesideActions}
      </div>
      {status}
      {explanationLine}
      {reopen}
      {error}
    </section>
  );
}
