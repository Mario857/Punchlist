import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { assertNever } from '@renderer/lib/assertNever';
import type { PrRef } from '@shared/discovery';
import {
  LANDING_UNDO_VIEW_KIND,
  useLandingUndo,
} from '@renderer/modules/landing/LandingUndo/useLandingUndo';

export interface LandingUndoProps {
  /** The PR on screen, whose runs return to approved when an undo succeeds. */
  prRef: PrRef | null;
}

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const SUB_HEADING_CLASS = 'text-ink text-xs font-semibold';
const BODY_CLASS = 'text-ink text-xs leading-relaxed';
const MUTED_CLASS = 'text-muted text-xs leading-relaxed';
const WARNING_CLASS = 'text-warning text-xs leading-relaxed';
const SUCCESS_CLASS = 'text-success text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const STATUS_CLASS = 'text-muted flex items-center gap-2 text-xs';
const ACTION_ROW_CLASS = 'flex flex-wrap items-center gap-2';

/**
 * The reverse of the landing gate. Offered only while the landing is still the most
 * recent one — and when it is not, that rule is stated rather than the control quietly
 * disappearing, because the remedy is then a git operation the user performs themselves.
 */
export function LandingUndo({ prRef }: LandingUndoProps) {
  const { heading, view, auditNoticeLabel, errorMessage } = useLandingUndo({ prRef });

  const content = (() => {
    switch (view.kind) {
      case LANDING_UNDO_VIEW_KIND.LOADING:
        return (
          <p role="status" className={STATUS_CLASS}>
            <Spinner size={SPINNER_SIZE.SM} label={view.loadingLabel} />
            {view.loadingLabel}
          </p>
        );
      case LANDING_UNDO_VIEW_KIND.UNAVAILABLE:
        return <p className={MUTED_CLASS}>{view.unavailableLabel}</p>;
      case LANDING_UNDO_VIEW_KIND.OFFERED:
        return (
          <div className={COLUMN_CLASS}>
            <p className={BODY_CLASS}>{view.landedLabel}</p>
            <p className={MUTED_CLASS}>{view.effectLabel}</p>
            <div className={ACTION_ROW_CLASS}>
              <Button
                variant={BUTTON_VARIANT.SECONDARY}
                size={BUTTON_SIZE.SM}
                title={view.reviewLabel}
                onClick={view.onReviewClick}
              >
                {view.reviewLabel}
              </Button>
            </div>
          </div>
        );
      case LANDING_UNDO_VIEW_KIND.CONFIRMING:
        return (
          <div className={COLUMN_CLASS}>
            <h4 className={SUB_HEADING_CLASS}>{view.confirmHeading}</h4>
            {/* role="alert" so the one thing an undo cannot reverse is announced when
                this step opens, not merely coloured for whoever happens to look. */}
            <p role="alert" className={WARNING_CLASS}>
              {view.replyWarningLabel}
            </p>
            <p className={BODY_CLASS}>{view.effectLabel}</p>
            <div className={ACTION_ROW_CLASS}>
              <Button
                variant={BUTTON_VARIANT.DANGER}
                size={BUTTON_SIZE.SM}
                isLoading={view.isUndoExecuting}
                title={view.confirmLabel}
                onClick={view.onConfirmClick}
              >
                {view.confirmLabel}
              </Button>
              <Button
                variant={BUTTON_VARIANT.SECONDARY}
                size={BUTTON_SIZE.SM}
                isDisabled={view.isUndoExecuting}
                title={view.keepLabel}
                onClick={view.onKeepClick}
              >
                {view.keepLabel}
              </Button>
            </div>
          </div>
        );
      case LANDING_UNDO_VIEW_KIND.UNDONE:
        return (
          <div role="status" className={COLUMN_CLASS}>
            <p className={SUCCESS_CLASS}>{view.undoneLabel}</p>
            <p className={WARNING_CLASS}>{view.replyLabel}</p>
          </div>
        );
      default:
        return assertNever(view);
    }
  })();

  const error =
    errorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {errorMessage}
      </p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <h3 className={HEADING_CLASS}>{heading}</h3>
      {content}
      {error}
      <p className={MUTED_CLASS}>{auditNoticeLabel}</p>
    </Card>
  );
}
