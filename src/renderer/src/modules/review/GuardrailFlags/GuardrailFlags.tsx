import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { useGuardrailFlags } from '@renderer/modules/review/GuardrailFlags/useGuardrailFlags';

export interface GuardrailFlagsProps {
  runId: string;
}

const LIST_LABEL = 'Guardrail flags';
const DETAIL_LABEL = 'What the check found';

/** One step up from a badge glyph: this is the heading mark for a flagged item. */
const FLAG_ICON_SIZE = 14;

const CARD_COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-xs font-semibold tracking-wide uppercase';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const LIST_CLASS = 'flex flex-col gap-2';
const ITEM_CLASS = 'border-border bg-surface flex flex-col gap-1.5 rounded-md border p-2';
const ITEM_HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const ITEM_TITLE_CLASS = 'text-ink min-w-0 flex-1 text-xs font-semibold';
const FLAG_ICON_CLASS = 'text-warning shrink-0';
const REASON_CLASS = 'text-muted text-xs leading-relaxed';
const DETAIL_LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const DETAIL_CLASS = 'text-ink font-mono text-xs break-words';

/**
 * A warning surface, not a gate: the findings are shown beside the patch they are
 * about, and the reviewer reads both and decides. Nothing here blocks approval — the
 * landing preview re-runs its own checks before anything leaves the sandbox.
 */
export function GuardrailFlags({ runId }: GuardrailFlagsProps) {
  const { heading, explanation, items } = useGuardrailFlags({ runId });

  const flagItems = items.map((item) => {
    const pathBadge =
      item.path === null ? null : (
        <Badge tone={BADGE_TONE.NEUTRAL} isMuted title={item.path}>
          {item.path}
        </Badge>
      );

    return (
      <li key={item.id} className={ITEM_CLASS}>
        <div className={ITEM_HEADER_CLASS}>
          <AlertTriangleIcon size={FLAG_ICON_SIZE} className={FLAG_ICON_CLASS} />
          <h3 className={ITEM_TITLE_CLASS}>{item.kindLabel}</h3>
          {pathBadge}
        </div>
        <p className={REASON_CLASS}>{item.reason}</p>
        <p className={DETAIL_LABEL_CLASS}>{DETAIL_LABEL}</p>
        <p className={DETAIL_CLASS}>{item.detail}</p>
      </li>
    );
  });

  const explanationLine =
    explanation === null ? null : <p className={EXPLANATION_CLASS}>{explanation}</p>;

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.SM} className={CARD_COLUMN_CLASS}>
      <h3 className={HEADING_CLASS}>{heading}</h3>
      {explanationLine}
      <ul aria-label={LIST_LABEL} className={LIST_CLASS}>
        {flagItems}
      </ul>
    </Card>
  );
}
