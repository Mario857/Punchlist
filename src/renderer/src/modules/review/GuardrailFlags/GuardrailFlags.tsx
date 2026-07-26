import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { CollapsibleCard } from '@renderer/components/CollapsibleCard/CollapsibleCard';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { CheckIcon } from '@renderer/components/icons/CheckIcon';
import { useGuardrailFlags } from '@renderer/modules/review/GuardrailFlags/useGuardrailFlags';

export interface GuardrailFlagsProps {
  runId: string;
}

const LIST_LABEL = 'Guardrail flags';
const ACKNOWLEDGED_LABEL = 'Acknowledged';
const DETAIL_LABEL = 'What the check found';

/** Matches the row badges, so every small mark in the app agrees in weight. */
const BADGE_ICON_SIZE = 11;

/** One step up from a badge glyph: this is the heading mark for a flagged item. */
const FLAG_ICON_SIZE = 14;

const SECTION_ID = 'guardrail-flags';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const STATUS_CLASS = 'text-warning text-xs leading-relaxed';
const LIST_CLASS = 'flex flex-col gap-2';
const ITEM_CLASS = 'border-border bg-surface flex flex-col gap-1.5 rounded-md border p-2';
const ITEM_HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const ITEM_TITLE_CLASS = 'text-ink min-w-0 flex-1 text-xs font-semibold';
const FLAG_ICON_CLASS = 'text-warning shrink-0';
const REASON_CLASS = 'text-muted text-xs leading-relaxed';
const DETAIL_LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const DETAIL_CLASS = 'text-ink font-mono text-xs break-words';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

/**
 * The acknowledgement surface, not an error surface: flags are shown so a deliberate
 * decision can be recorded, and an acknowledged one stays listed because that record is
 * the whole point of the check.
 */
export function GuardrailFlags({ runId }: GuardrailFlagsProps) {
  const {
    heading,
    summary,
    isDefaultOpen,
    explanation,
    items,
    statusLabel,
    isAcknowledgePending,
    acknowledgeErrorMessage,
  } = useGuardrailFlags({ runId });

  const flagItems = items.map((item) => {
    const pathBadge =
      item.path === null ? null : (
        <Badge tone={BADGE_TONE.NEUTRAL} isMuted title={item.path}>
          {item.path}
        </Badge>
      );

    const action = item.isAcknowledged ? (
      <Badge
        tone={BADGE_TONE.SUCCESS}
        isMuted
        icon={<CheckIcon size={BADGE_ICON_SIZE} />}
        title={ACKNOWLEDGED_LABEL}
      >
        {ACKNOWLEDGED_LABEL}
      </Badge>
    ) : (
      <Button
        variant={BUTTON_VARIANT.SECONDARY}
        size={BUTTON_SIZE.SM}
        isDisabled={isAcknowledgePending}
        title={item.acknowledgeLabel}
        onClick={item.onAcknowledgeClick}
      >
        {item.acknowledgeLabel}
      </Button>
    );

    return (
      <li key={item.id} className={ITEM_CLASS}>
        <div className={ITEM_HEADER_CLASS}>
          <AlertTriangleIcon size={FLAG_ICON_SIZE} className={FLAG_ICON_CLASS} />
          <h3 className={ITEM_TITLE_CLASS}>{item.kindLabel}</h3>
          {pathBadge}
          {action}
        </div>
        <p className={REASON_CLASS}>{item.reason}</p>
        <p className={DETAIL_LABEL_CLASS}>{DETAIL_LABEL}</p>
        <p className={DETAIL_CLASS}>{item.detail}</p>
      </li>
    );
  });

  const acknowledgeError =
    acknowledgeErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {acknowledgeErrorMessage}
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
      {explanationLine}
      <p role="status" className={STATUS_CLASS}>
        {statusLabel}
      </p>
      <ul aria-label={LIST_LABEL} className={LIST_CLASS}>
        {flagItems}
      </ul>
      {acknowledgeError}
    </CollapsibleCard>
  );
}
