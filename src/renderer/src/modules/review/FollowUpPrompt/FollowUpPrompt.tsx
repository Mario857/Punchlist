import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useFollowUpPrompt } from '@renderer/modules/review/FollowUpPrompt/useFollowUpPrompt';

export interface FollowUpPromptProps {
  runId: string;
}

const CARD_COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-xs font-semibold tracking-wide uppercase';
const SECTION_LABEL = 'Follow-up prompt';

const PROMPT_FIELD_CLASS = joinClassNames(
  'border-border bg-surface text-ink w-full rounded-md border p-2',
  'text-xs leading-relaxed',
  'placeholder:text-muted/70',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const COLUMN_CLASS = 'flex flex-col gap-1.5';
const LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const META_CLASS = 'text-muted text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const REMEDIATION_CLASS = 'text-muted block';
const ACTION_ROW_CLASS = 'flex items-center gap-2';

/**
 * Sits beside the patch it talks about, because a follow-up is written while reading the
 * diff. Its whole job is one `agent.send` on the run's existing agent.
 */
export function FollowUpPrompt({ runId }: FollowUpPromptProps) {
  const {
    heading,
    explanation,
    promptFieldId,
    promptLabel,
    promptPlaceholder,
    promptRowCount,
    promptDraft,
    sendLabel,
    isSendDisabled,
    isSendPending,
    sendPendingLabel,
    sendErrorMessage,
    sendErrorRemediation,
    onPromptChange,
    onSendClick,
  } = useFollowUpPrompt({ runId });

  const sendPending =
    sendPendingLabel === null ? null : (
      <p role="status" className={META_CLASS}>
        {sendPendingLabel}
      </p>
    );

  const sendErrorRemediationLine =
    sendErrorRemediation === null ? null : (
      <span className={REMEDIATION_CLASS}>{sendErrorRemediation}</span>
    );

  const sendError =
    sendErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {sendErrorMessage}
        {sendErrorRemediationLine}
      </p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.SM} className={CARD_COLUMN_CLASS}>
      <h3 className={HEADING_CLASS}>{heading}</h3>
      <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
        <p className={META_CLASS}>{explanation}</p>
        <label htmlFor={promptFieldId} className={LABEL_CLASS}>
          {promptLabel}
        </label>
        <textarea
          id={promptFieldId}
          rows={promptRowCount}
          value={promptDraft}
          placeholder={promptPlaceholder}
          disabled={isSendPending}
          onChange={onPromptChange}
          className={PROMPT_FIELD_CLASS}
        />
        {sendPending}
        {sendError}
        <div className={ACTION_ROW_CLASS}>
          <Button
            variant={BUTTON_VARIANT.SECONDARY}
            size={BUTTON_SIZE.SM}
            isDisabled={isSendDisabled}
            isLoading={isSendPending}
            title={sendLabel}
            onClick={onSendClick}
          >
            {sendLabel}
          </Button>
        </div>
      </section>
    </Card>
  );
}
