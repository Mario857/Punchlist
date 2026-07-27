import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { assertNever } from '@renderer/lib/assertNever';
import type { PrRef } from '@shared/discovery';
import { LandingCombinedDiff } from '@renderer/modules/landing/LandingPreview/components/LandingCombinedDiff/LandingCombinedDiff';
import { LandingCommitList } from '@renderer/modules/landing/LandingPreview/components/LandingCommitList';
import { LandingConfirmBar } from '@renderer/modules/landing/LandingPreview/components/LandingConfirmBar';
import { LandingConflictList } from '@renderer/modules/landing/LandingPreview/components/LandingConflictList';
import { LandingTargetCard } from '@renderer/modules/landing/LandingPreview/components/LandingTargetCard';
import { LANDING_VIEW_KIND } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';
import { useLandingPreview } from '@renderer/modules/landing/LandingPreview/useLandingPreview';

export interface LandingPreviewProps {
  /** Null before a PR is selected: the gate then has nothing to describe. */
  prRef: PrRef | null;
  /**
   * The branch the integration branch is assembled onto, and the one thing this screen
   * promises never to push to.
   */
  targetBranch: string | null;
}

const SECTION_LABEL = 'Landing preview';

const SECTION_CLASS = 'flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const EMPTY_STATE_CLASS = 'text-muted grid flex-1 place-items-center p-6 text-center text-sm';
const STATUS_CLASS = 'text-muted flex items-center gap-2 text-xs';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const REMEDIATION_CLASS = 'text-muted block';
const ACTION_ROW_CLASS = 'flex items-center gap-2';
const COLUMN_CLASS = 'flex flex-col gap-3';

/**
 * The confirmation gate. Everything it shows exists so that confirming is an informed
 * act rather than a leap: the commits and their editable messages, the combined diff,
 * where it lands, which threads it resolves, what reply it posts, and what has to be
 * acknowledged first. Nothing here runs until the button below is clicked, and there is
 * deliberately no keyboard binding for that click.
 */
export function LandingPreview({ prRef, targetBranch }: LandingPreviewProps) {
  const { heading, explanation, view } = useLandingPreview({ prRef, targetBranch });

  const content = (() => {
    switch (view.kind) {
      case LANDING_VIEW_KIND.NOTHING_TO_PREVIEW:
        return <p className={EMPTY_STATE_CLASS}>{view.emptyStateLabel}</p>;
      case LANDING_VIEW_KIND.ASSEMBLING:
        return (
          <p role="status" className={STATUS_CLASS}>
            <Spinner size={SPINNER_SIZE.SM} label={view.assemblingLabel} />
            {view.assemblingLabel}
          </p>
        );
      case LANDING_VIEW_KIND.FAILED: {
        const remediation =
          view.errorRemediation === null ? null : (
            <span className={REMEDIATION_CLASS}>{view.errorRemediation}</span>
          );

        return (
          <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
            <p role="alert" className={ERROR_CLASS}>
              {view.errorMessage}
              {remediation}
            </p>
            <div className={ACTION_ROW_CLASS}>
              <Button
                variant={BUTTON_VARIANT.SECONDARY}
                size={BUTTON_SIZE.SM}
                title={view.retryLabel}
                onClick={view.onRetryClick}
              >
                {view.retryLabel}
              </Button>
            </div>
          </Card>
        );
      }
      case LANDING_VIEW_KIND.PREVIEW: {
        // Above everything it would block, because a conflict changes what the rest of
        // this screen is for: reading it, not confirming it.
        const conflicts =
          view.conflicts === null ? null : <LandingConflictList view={view.conflicts} />;

        // Absent entirely while a conflict stands — the gate is not offered, rather than
        // offered and refused.
        const confirm = view.confirm === null ? null : <LandingConfirmBar view={view.confirm} />;

        return (
          <div className={COLUMN_CLASS}>
            <LandingTargetCard view={view.target} />
            {conflicts}
            <LandingCommitList view={view.commits} />
            <LandingCombinedDiff view={view.combinedDiff} />
            {confirm}
          </div>
        );
      }
      default:
        return assertNever(view);
    }
  })();

  return (
    <section aria-label={SECTION_LABEL} className={SECTION_CLASS}>
      <header>
        <h2 className={HEADING_CLASS}>{heading}</h2>
        <p className={EXPLANATION_CLASS}>{explanation}</p>
      </header>
      {content}
    </section>
  );
}
