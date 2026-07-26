import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { useRunEscalation } from './useRunEscalation';

export interface RunEscalationProps {
  runId: string;
}

const HEADING = 'Retry this run';
const EFFORT_LABEL = 'Retry with higher reasoning effort';
const EFFORT_EXPLANATION =
  'Stays on the unlimited lane and only dials reasoning effort up, so it costs nothing.';
const FRONTIER_HEADING = 'Retry with a frontier model';
const FRONTIER_EXPLANATION =
  'Pins the model you choose, which bills the included dollar pool at API rates. Nothing else on this screen spends money.';
const FRONTIER_BADGE_LABEL = 'Spends pool';
const FRONTIER_RETRY_LABEL_PREFIX = 'Retry with ';

const CONFIRM_HEADING = 'This retry discards your edits';
const CONFIRM_LABEL = 'Discard edits and retry';
const KEEP_EDITS_LABEL = 'Keep the edits';

const CARD_COLUMN_CLASS = 'flex flex-col gap-3';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const ACTION_ROW_CLASS = 'flex items-center gap-2';
const FRONTIER_BUTTON_ROW_CLASS = 'mt-2 flex flex-wrap items-center gap-2';
const EXPLANATION_CLASS = 'text-muted mt-1 text-xs leading-relaxed';
const WARNING_CLASS = 'text-warning text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

/**
 * Two retries, deliberately unequal. Raising reasoning effort is the free one and
 * comes first; the frontier model is a separate, labelled, pool-spending action and
 * is never the primary button.
 */
export function RunEscalation({ runId }: RunEscalationProps) {
  const {
    isEscalateRunPending,
    frontierRetryOptions,
    frontierUnavailableMessage,
    isDiscardConfirmationOpen,
    discardWarningMessage,
    errorMessage,
    onRetryWithMoreEffortClick,
    onConfirmDiscardClick,
    onKeepEditsClick,
  } = useRunEscalation({ runId });

  const frontierButtons = frontierRetryOptions.map((option) => (
    <Button
      key={option.modelId}
      variant={BUTTON_VARIANT.GHOST}
      size={BUTTON_SIZE.SM}
      isDisabled={isEscalateRunPending}
      onClick={option.onRetryClick}
    >
      {`${FRONTIER_RETRY_LABEL_PREFIX}${option.label}`}
    </Button>
  ));

  const frontierUnavailable =
    frontierUnavailableMessage === null ? null : (
      <p className={EXPLANATION_CLASS}>{frontierUnavailableMessage}</p>
    );

  const retryActions = (
    <div className={CARD_COLUMN_CLASS}>
      <div>
        <Button
          variant={BUTTON_VARIANT.SECONDARY}
          size={BUTTON_SIZE.SM}
          isLoading={isEscalateRunPending}
          onClick={onRetryWithMoreEffortClick}
        >
          {EFFORT_LABEL}
        </Button>
        <p className={EXPLANATION_CLASS}>{EFFORT_EXPLANATION}</p>
      </div>
      <div>
        <div className={ACTION_ROW_CLASS}>
          <h3 className={HEADING_CLASS}>{FRONTIER_HEADING}</h3>
          <Badge tone={BADGE_TONE.WARNING}>{FRONTIER_BADGE_LABEL}</Badge>
        </div>
        <p className={EXPLANATION_CLASS}>{FRONTIER_EXPLANATION}</p>
        {frontierUnavailable}
        <div className={FRONTIER_BUTTON_ROW_CLASS}>{frontierButtons}</div>
      </div>
    </div>
  );

  const discardConfirmation = (
    <div className={CARD_COLUMN_CLASS}>
      <div>
        <h3 className={HEADING_CLASS}>{CONFIRM_HEADING}</h3>
        <p className={WARNING_CLASS}>{discardWarningMessage}</p>
      </div>
      <div className={ACTION_ROW_CLASS}>
        <Button
          variant={BUTTON_VARIANT.DANGER}
          size={BUTTON_SIZE.SM}
          isLoading={isEscalateRunPending}
          onClick={onConfirmDiscardClick}
        >
          {CONFIRM_LABEL}
        </Button>
        <Button
          variant={BUTTON_VARIANT.SECONDARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isEscalateRunPending}
          onClick={onKeepEditsClick}
        >
          {KEEP_EDITS_LABEL}
        </Button>
      </div>
    </div>
  );

  const actions = isDiscardConfirmationOpen ? discardConfirmation : retryActions;

  const error =
    errorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {errorMessage}
      </p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={CARD_COLUMN_CLASS}>
      <h2 className={HEADING_CLASS}>{HEADING}</h2>
      {actions}
      {error}
    </Card>
  );
}
