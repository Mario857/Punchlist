import type { TargetedEditSelection } from '@shared/runs';
import { Badge } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useInlinePrompt } from '@renderer/modules/review/InlinePrompt/useInlinePrompt';

export interface InlinePromptProps {
  runId: string;
  /**
   * Frozen when the prompt opened, so typing in the diff underneath cannot change what
   * is about to be sent.
   */
  selection: TargetedEditSelection;
  /** True while an earlier send is still with the agent; this one queues behind it. */
  isSendPending: boolean;
  onSend: (message: string) => void;
  onDismiss: () => void;
}

const SECTION_LABEL = 'Targeted edit';

const PROMPT_FIELD_CLASS = joinClassNames(
  'border-border bg-surface text-ink w-full rounded-md border p-2',
  'text-xs leading-relaxed',
  'placeholder:text-muted/70',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const SELECTION_PREVIEW_CLASS = joinClassNames(
  'border-border bg-surface text-ink max-h-32 overflow-y-auto rounded-md border p-2',
  'font-mono text-xs leading-relaxed whitespace-pre-wrap',
);

const COLUMN_CLASS = 'flex flex-col gap-1.5';
const HEADER_CLASS = 'flex items-center gap-2';
const HEADING_CLASS = 'text-ink min-w-0 flex-1 text-sm font-semibold';
const LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const META_CLASS = 'text-muted text-xs leading-relaxed';
const RANGE_CLASS = 'text-muted truncate font-mono text-xs';
const ACTION_ROW_CLASS = 'flex items-center gap-2';

/**
 * The Cursor inline-edit interaction: select the lines that are wrong, say what is
 * wrong, and the agent revises that region only. Presentation only — the selection was
 * captured by the diff, and the send is the diff's `agent.send` on the same agent.
 */
export function InlinePrompt({
  runId,
  selection,
  isSendPending,
  onSend,
  onDismiss,
}: InlinePromptProps) {
  const {
    heading,
    explanation,
    sideLabel,
    sideTone,
    rangeLabel,
    anchorExplanation,
    selectionPreview,
    promptFieldId,
    promptLabel,
    promptPlaceholder,
    promptRowCount,
    promptDraft,
    sendLabel,
    sendTitle,
    isSendDisabled,
    sendPendingLabel,
    dismissLabel,
    dismissTitle,
    onPromptChange,
    onPromptKeyDown,
    onSendClick,
    onDismissClick,
  } = useInlinePrompt({ runId, selection, isSendPending, onSend, onDismiss });

  const sendPending =
    sendPendingLabel === null ? null : (
      <p role="status" className={META_CLASS}>
        {sendPendingLabel}
      </p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.SM}>
      <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
        <header className={HEADER_CLASS}>
          <h3 className={HEADING_CLASS}>{heading}</h3>
          <Badge tone={sideTone}>{sideLabel}</Badge>
        </header>
        <p className={META_CLASS}>{explanation}</p>
        <p className={RANGE_CLASS} title={rangeLabel}>
          {rangeLabel}
        </p>
        <pre className={SELECTION_PREVIEW_CLASS}>{selectionPreview}</pre>
        <p className={META_CLASS}>{anchorExplanation}</p>
        <label htmlFor={promptFieldId} className={LABEL_CLASS}>
          {promptLabel}
        </label>
        <textarea
          id={promptFieldId}
          rows={promptRowCount}
          value={promptDraft}
          placeholder={promptPlaceholder}
          // Opened by an explicit shortcut or button, so focus follows the intent that
          // opened it rather than costing a second click.
          autoFocus
          onChange={onPromptChange}
          onKeyDown={onPromptKeyDown}
          className={PROMPT_FIELD_CLASS}
        />
        {sendPending}
        <div className={ACTION_ROW_CLASS}>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            size={BUTTON_SIZE.SM}
            isDisabled={isSendDisabled}
            title={sendTitle}
            onClick={onSendClick}
          >
            {sendLabel}
          </Button>
          <Button
            variant={BUTTON_VARIANT.GHOST}
            size={BUTTON_SIZE.SM}
            title={dismissTitle}
            onClick={onDismissClick}
          >
            {dismissLabel}
          </Button>
        </div>
      </section>
    </Card>
  );
}
