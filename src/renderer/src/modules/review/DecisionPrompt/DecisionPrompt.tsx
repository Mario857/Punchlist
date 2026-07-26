import type { AgentDecision } from '@shared/runs';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useDecisionPrompt } from '@renderer/modules/review/DecisionPrompt/useDecisionPrompt';

export interface DecisionPromptProps {
  runId: string;
  /** The agent halted on a real fork rather than guessing; this is what it asked. */
  decision: AgentDecision;
}

const SECTION_LABEL = 'Decision requested';
const HEADING = 'The agent stopped to ask';
const HEADING_EXPLANATION =
  'It hit a genuine fork and halted instead of guessing, so nothing has been written on the wrong assumption.';
const CONTEXT_HEADING = 'What it found';
const OPTIONS_HEADING = 'Options, best first';
const RECOMMENDED_LABEL = 'Recommended';
const SEND_LABEL = 'Send answer';

const REPLY_ROW_COUNT = 4;

const OPTION_CLASS = joinClassNames(
  'border-border bg-surface flex w-full items-center gap-2 rounded-md border px-2 py-1.5',
  'text-ink text-left text-xs',
  'hover:border-border-strong hover:bg-surface-hover',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const OPTION_SELECTED_CLASS = 'border-accent bg-accent/10';

const REPLY_FIELD_CLASS = joinClassNames(
  'border-border bg-surface-raised text-ink w-full rounded-md border p-2',
  'text-xs leading-relaxed',
  'placeholder:text-muted/70',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const HEADING_CLASS = 'text-ink text-sm font-semibold';
const SUB_HEADING_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const BODY_CLASS = 'text-ink text-sm leading-relaxed';
const META_CLASS = 'text-muted text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const REMEDIATION_CLASS = 'text-muted block';

/**
 * needsDecision is not a failure, so this reads as a prompt waiting on you rather than
 * an error: warning tone, no alert role, and the question in body text.
 */
export function DecisionPrompt({ runId, decision }: DecisionPromptProps) {
  const {
    question,
    contextText,
    optionItems,
    hasChoosableOptions,
    replyFieldId,
    replyLabel,
    replyExplanation,
    replyPlaceholder,
    replyDraft,
    isSendDisabled,
    isSendPending,
    sendPendingLabel,
    sendErrorMessage,
    sendErrorRemediation,
    onReplyChange,
    onSendClick,
  } = useDecisionPrompt({ runId, decision });

  const optionButtons = optionItems.map((item) => {
    const optionClassName = item.isSelected
      ? joinClassNames(OPTION_CLASS, OPTION_SELECTED_CLASS)
      : OPTION_CLASS;
    const recommendedBadge = item.isRecommended ? (
      <Badge tone={BADGE_TONE.ACCENT}>{RECOMMENDED_LABEL}</Badge>
    ) : null;

    return (
      <li key={item.key}>
        <button
          type="button"
          onClick={item.onSelect}
          disabled={isSendPending}
          aria-pressed={item.isSelected}
          className={optionClassName}
        >
          <span className="min-w-0 flex-1">{item.label}</span>
          {recommendedBadge}
        </button>
      </li>
    );
  });

  const optionList = hasChoosableOptions ? (
    <div className="flex flex-col gap-1.5">
      <p className={SUB_HEADING_CLASS}>{OPTIONS_HEADING}</p>
      <ul className="flex flex-col gap-1.5">{optionButtons}</ul>
    </div>
  ) : null;

  const context =
    contextText === null ? null : (
      <div className="flex flex-col gap-1">
        <p className={SUB_HEADING_CLASS}>{CONTEXT_HEADING}</p>
        <p className={META_CLASS}>{contextText}</p>
      </div>
    );

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
    <section aria-label={SECTION_LABEL} className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <header className="flex flex-col gap-1">
        <h2 className={HEADING_CLASS}>{HEADING}</h2>
        <p className={META_CLASS}>{HEADING_EXPLANATION}</p>
      </header>

      <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.SM}>
        <p className={BODY_CLASS}>{question}</p>
      </Card>

      {context}
      {optionList}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={replyFieldId} className={SUB_HEADING_CLASS}>
          {replyLabel}
        </label>
        <p className={META_CLASS}>{replyExplanation}</p>
        <textarea
          id={replyFieldId}
          rows={REPLY_ROW_COUNT}
          value={replyDraft}
          placeholder={replyPlaceholder}
          disabled={isSendPending}
          onChange={onReplyChange}
          className={REPLY_FIELD_CLASS}
        />
        {sendPending}
        {sendError}
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isSendDisabled}
          isLoading={isSendPending}
          title={SEND_LABEL}
          onClick={onSendClick}
        >
          {SEND_LABEL}
        </Button>
      </div>
    </section>
  );
}
