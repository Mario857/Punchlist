import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import type { LandingConfirmView } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

interface Props {
  view: LandingConfirmView;
}

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const BLOCKER_CLASS = 'text-warning text-xs leading-relaxed';
const NOTICE_CLASS = 'text-muted text-xs leading-relaxed';
const ACTION_ROW_CLASS = 'flex items-center gap-2';

/**
 * The outer door. It carries no keyboard binding on purpose: a shortcut may open this
 * preview, but confirming is a click, because the one action that reaches the real
 * repository must not become muscle memory.
 *
 * The button has no click handler at all rather than one that silently does nothing —
 * there is no execute channel on the bridge yet, and the notice below says so.
 */
export function LandingConfirmBar({ view }: Props) {
  const blocker =
    view.blockerLabel === null ? null : (
      <p role="status" className={BLOCKER_CLASS}>
        {view.blockerLabel}
      </p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <h3 className={HEADING_CLASS}>{view.heading}</h3>
      {blocker}
      <p className={NOTICE_CLASS}>{view.executionNoticeLabel}</p>
      <div className={ACTION_ROW_CLASS}>
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          size={BUTTON_SIZE.MD}
          isDisabled={view.isConfirmDisabled}
          title={view.confirmLabel}
        >
          {view.confirmLabel}
        </Button>
      </div>
    </Card>
  );
}
