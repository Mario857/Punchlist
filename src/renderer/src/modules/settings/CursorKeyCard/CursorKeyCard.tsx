import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { DISABLED_STATE, FOCUS_RING } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useCursorKeyCard } from '@renderer/modules/settings/CursorKeyCard/useCursorKeyCard';

const KEY_INPUT_ID = 'settings-cursor-api-key';
const STORED_BADGE_LABEL = 'Stored';
const MISSING_BADGE_LABEL = 'Not set';

const COLUMN_CLASS = 'flex flex-col gap-3';
const HEADER_CLASS = 'flex items-center justify-between gap-3';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const STATUS_CLASS = 'text-muted text-xs';
const LABEL_CLASS = 'text-muted text-xs';
const ACTION_ROW_CLASS = 'flex flex-wrap items-center gap-2';
const ERROR_CLASS = 'text-danger text-xs';
const REMEDIATION_CLASS = 'text-muted mt-1 text-xs';
const INPUT_CLASS =
  'border-border bg-surface-raised text-ink w-full rounded border px-2 py-1 text-sm';

export function CursorKeyCard() {
  const {
    heading,
    explanation,
    statusLabel,
    isCursorKeySet,
    fieldLabel,
    fieldPlaceholder,
    draft,
    saveLabel,
    clearLabel,
    isSaveDisabled,
    isPending,
    errorMessage,
    errorRemediation,
    onDraftChange,
    onSaveClick,
    onClearClick,
  } = useCursorKeyCard();

  const statusBadge = isCursorKeySet ? (
    <Badge tone={BADGE_TONE.SUCCESS} isMuted>
      {STORED_BADGE_LABEL}
    </Badge>
  ) : (
    <Badge tone={BADGE_TONE.WARNING} isMuted>
      {MISSING_BADGE_LABEL}
    </Badge>
  );

  const clearButton =
    clearLabel === null ? null : (
      <Button
        variant={BUTTON_VARIANT.GHOST}
        size={BUTTON_SIZE.SM}
        isDisabled={isPending}
        onClick={onClearClick}
      >
        {clearLabel}
      </Button>
    );

  const errorRemediationLine =
    errorRemediation === null ? null : <p className={REMEDIATION_CLASS}>{errorRemediation}</p>;

  const errorLine =
    errorMessage === null ? null : (
      <div role="alert">
        <p className={ERROR_CLASS}>{errorMessage}</p>
        {errorRemediationLine}
      </div>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <div className={HEADER_CLASS}>
        <h3 className={HEADING_CLASS}>{heading}</h3>
        {statusBadge}
      </div>
      <p className={EXPLANATION_CLASS}>{explanation}</p>
      <p className={STATUS_CLASS}>{statusLabel}</p>

      <label className={LABEL_CLASS} htmlFor={KEY_INPUT_ID}>
        {fieldLabel}
      </label>
      <input
        id={KEY_INPUT_ID}
        // A password field: the value is a secret, and it is never read back into
        // this input from anywhere, so it starts and ends empty.
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={fieldPlaceholder}
        onChange={(event) => onDraftChange(event.target.value)}
        className={joinClassNames(INPUT_CLASS, FOCUS_RING, DISABLED_STATE)}
      />

      <div className={ACTION_ROW_CLASS}>
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isSaveDisabled}
          isLoading={isPending}
          onClick={onSaveClick}
        >
          {saveLabel}
        </Button>
        {clearButton}
      </div>
      {errorLine}
    </Card>
  );
}
