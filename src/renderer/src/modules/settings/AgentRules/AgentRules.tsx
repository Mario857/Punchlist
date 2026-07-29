import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { FOCUS_RING } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useAgentRules } from '@renderer/modules/settings/AgentRules/useAgentRules';

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const TEXTAREA_CLASS =
  'border-border bg-surface text-ink w-full rounded-md border px-2 py-1.5 font-mono text-xs leading-relaxed';
const ROW_CLASS = 'flex items-center gap-2';
const COUNTER_CLASS = 'text-muted text-xs tabular-nums';
const SAVED_CLASS = 'text-success text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

/** The one place house rules are written; every prompt reads them from settings. */
export function AgentRules() {
  const {
    heading,
    explanation,
    fieldId,
    fieldLabel,
    placeholder,
    rowCount,
    draft,
    counterLabel,
    saveLabel,
    isSaveDisabled,
    isSavePending,
    savedLabel,
    errorMessage,
    onDraftChange,
    onSaveClick,
  } = useAgentRules();

  const saved = savedLabel === null ? null : <p className={SAVED_CLASS}>{savedLabel}</p>;

  const error =
    errorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {errorMessage}
      </p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <div>
        <h2 className={HEADING_CLASS}>{heading}</h2>
        <p className={EXPLANATION_CLASS}>{explanation}</p>
      </div>
      <label className={LABEL_CLASS} htmlFor={fieldId}>
        {fieldLabel}
      </label>
      <textarea
        id={fieldId}
        rows={rowCount}
        value={draft}
        placeholder={placeholder}
        onChange={onDraftChange}
        className={joinClassNames(TEXTAREA_CLASS, FOCUS_RING)}
      />
      <div className={ROW_CLASS}>
        <span className={COUNTER_CLASS}>{counterLabel}</span>
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          size={BUTTON_SIZE.SM}
          className="ml-auto"
          isDisabled={isSaveDisabled}
          isLoading={isSavePending}
          onClick={onSaveClick}
        >
          {saveLabel}
        </Button>
      </div>
      {saved}
      {error}
    </Card>
  );
}
