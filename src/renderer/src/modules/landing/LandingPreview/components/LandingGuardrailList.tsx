import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { CheckIcon } from '@renderer/components/icons/CheckIcon';
import type { LandingGuardrailsView } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

interface Props {
  view: LandingGuardrailsView;
}

/** Matches the row badges, so every small mark in the app agrees in weight. */
const BADGE_ICON_SIZE = 11;

/** One step up from a badge glyph: the heading mark for a flagged item. */
const FLAG_ICON_SIZE = 14;

const COLUMN_CLASS = 'flex flex-col gap-3';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const STATUS_CLASS = 'text-warning text-xs leading-relaxed';
const LIST_CLASS = 'flex flex-col gap-2';
const ITEM_CLASS = 'border-border bg-surface flex flex-col gap-1.5 rounded-md border p-2';
const ITEM_HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const ITEM_TITLE_CLASS = 'text-ink min-w-0 flex-1 text-xs font-semibold';
const FLAG_ICON_CLASS = 'text-warning shrink-0';
const DETAIL_CLASS = 'text-ink font-mono text-xs break-words';

/**
 * The combined diff's own acknowledgement surface. Separate from the per-patch flags by
 * design: this artifact can be flagged for something no single patch was, and these
 * acknowledgements travel with the confirmation rather than with any run.
 */
export function LandingGuardrailList({ view }: Props) {
  const items = view.items.map((item) => {
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
        title={item.acknowledgedLabel}
      >
        {item.acknowledgedLabel}
      </Badge>
    ) : (
      <Button
        variant={BUTTON_VARIANT.SECONDARY}
        size={BUTTON_SIZE.SM}
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
          <h4 className={ITEM_TITLE_CLASS}>{item.kindLabel}</h4>
          {pathBadge}
          {action}
        </div>
        <p className={DETAIL_CLASS}>{item.detail}</p>
      </li>
    );
  });

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <div>
        <h3 className={HEADING_CLASS}>{view.heading}</h3>
        <p className={EXPLANATION_CLASS}>{view.explanation}</p>
      </div>
      <p role="status" className={STATUS_CLASS}>
        {view.statusLabel}
      </p>
      <ul aria-label={view.heading} className={LIST_CLASS}>
        {items}
      </ul>
    </Card>
  );
}
