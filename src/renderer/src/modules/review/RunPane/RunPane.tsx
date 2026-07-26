import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { StateBadge } from '@renderer/components/StateBadge';
import { assertNever } from '@renderer/lib/assertNever';
import { AgentTranscript } from '@renderer/modules/review/AgentTranscript/AgentTranscript';
import { DecisionPrompt } from '@renderer/modules/review/DecisionPrompt/DecisionPrompt';
import { DiffReview } from '@renderer/modules/review/DiffReview/DiffReview';
import { FollowUpPrompt } from '@renderer/modules/review/FollowUpPrompt/FollowUpPrompt';
import { AutoDecisions } from '@renderer/modules/review/AutoDecisions/AutoDecisions';
import { GuardrailFlags } from '@renderer/modules/review/GuardrailFlags/GuardrailFlags';
import { RevisionHistory } from '@renderer/modules/review/RevisionHistory/RevisionHistory';
import { ReviewDecision } from '@renderer/modules/review/ReviewDecision/ReviewDecision';
import { SecondOpinion } from '@renderer/modules/review/SecondOpinion/SecondOpinion';
import { RunEscalation } from '@renderer/modules/review/RunPane/components/RunEscalation/RunEscalation';
import { RUN_PANE_VIEW_KIND, useRunPane } from '@renderer/modules/review/RunPane/useRunPane';

export interface RunPaneProps {
  /** The pane resolves its own run from the store; null is the no-selection state. */
  commentId: string | null;
}

const SECTION_LABEL = 'Run';
const VERBOSITY_TITLE =
  'Show or hide the paragraphs describing what each surface here means. The flags, verdicts and patch itself never hide — only the copy explaining them.';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted mt-1 text-xs leading-relaxed';
const HEADLINE_CLASS = 'text-muted text-xs leading-relaxed';
const EMPTY_STATE_CLASS = 'text-muted grid flex-1 place-items-center p-6 text-center text-sm';
const ERROR_MESSAGE_CLASS = 'text-danger mt-2 font-mono text-xs break-words';
const COLUMN_CLASS = 'flex min-h-0 flex-1 flex-col gap-2';
/**
 * `min-h-full`, not `h-full`: the diff view stacks cards around an editor with a
 * height floor, and a section pinned to the pane's height would clip them instead of
 * letting the pane scroll.
 */
const SECTION_CLASS = 'flex min-h-full flex-col gap-2 p-3';

/**
 * The state-dependent right pane. The branch is a named `const` over a discriminated
 * view computed in `useRunPane`, so markup stays a mapping from view kind to surface
 * and the `RunState` exhaustiveness check lives in one place.
 */
export function RunPane({ commentId }: RunPaneProps) {
  const { view, runState, metaLabel, isVerbose, verbosityLabel, onToggleVerbosityClick } =
    useRunPane(commentId);

  const stateBadge = runState === null ? null : <StateBadge state={runState} />;
  const meta = metaLabel === null ? null : <span className="text-muted text-xs">{metaLabel}</span>;

  const content = (() => {
    switch (view.kind) {
      case RUN_PANE_VIEW_KIND.NO_RUN:
        return <p className={EMPTY_STATE_CLASS}>{view.emptyStateLabel}</p>;
      case RUN_PANE_VIEW_KIND.TRANSCRIPT:
        return (
          <div className={COLUMN_CLASS}>
            <p className={HEADLINE_CLASS}>{view.headline}</p>
            <AgentTranscript transcript={view.transcript} isStreaming={view.isStreaming} />
          </div>
        );
      case RUN_PANE_VIEW_KIND.DECISION:
        return <DecisionPrompt key={view.runId} runId={view.runId} decision={view.decision} />;
      case RUN_PANE_VIEW_KIND.DIFF: {
        // Keyed per run so a drafted follow-up cannot follow the selection onto a
        // different comment's patch.
        const followUpPrompt = view.isFollowUpAvailable ? (
          <FollowUpPrompt key={view.runId} runId={view.runId} />
        ) : null;

        // Above the diff rather than under it: a flag is worth seeing before you start
        // reading the patch, not after you have already scrolled it.
        const guardrailFlags = view.hasGuardrailFlags ? (
          <GuardrailFlags key={view.runId} runId={view.runId} />
        ) : null;

        // Under the patch and the prompt: the trail undoes a step you have already read
        // rather than being something to read first.
        const revisionHistory = view.isRevisionHistoryAvailable ? (
          <RevisionHistory key={view.runId} runId={view.runId} />
        ) : null;

        // Beside the flags and above the patch, for the same reason: a decision taken
        // without you is something to know before you read the diff it produced.
        const autoDecisions = <AutoDecisions key={view.runId} runId={view.runId} />;

        // With the flags and the auto-decisions, because a second reader's verdict is
        // worth having before you read the patch — but it is the one card up here that
        // gates nothing, and asking for one lives in it so the answer arrives where the
        // question was put.
        const secondOpinion = view.isSecondOpinionAvailable ? (
          <SecondOpinion key={view.runId} runId={view.runId} />
        ) : null;

        // Directly under the patch: the decision is what you take once you have read
        // it, and it must come before the ways of asking for more work rather than
        // after them.
        const reviewDecision = view.isReviewDecisionAvailable ? (
          <ReviewDecision key={view.runId} runId={view.runId} />
        ) : null;

        return (
          <div className={COLUMN_CLASS}>
            {guardrailFlags}
            {autoDecisions}
            {secondOpinion}
            <DiffReview
              key={view.runId}
              runId={view.runId}
              revisionProgressLabel={view.revisionProgressLabel}
              isEditable={view.isPatchEditable}
            />
            {reviewDecision}
            {followUpPrompt}
            {revisionHistory}
          </div>
        );
      }
      case RUN_PANE_VIEW_KIND.NO_ACTION_NEEDED:
        return (
          <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD}>
            <h2 className={HEADING_CLASS}>{view.heading}</h2>
            <p className={EXPLANATION_CLASS}>{view.explanation}</p>
          </Card>
        );
      case RUN_PANE_VIEW_KIND.FAILURE: {
        const settingsHint =
          view.settingsHint === null ? null : (
            <p className={EXPLANATION_CLASS}>{view.settingsHint}</p>
          );
        const errorMessage =
          view.errorMessage === null ? null : (
            <p className={ERROR_MESSAGE_CLASS}>{view.errorMessage}</p>
          );

        return (
          <div className={COLUMN_CLASS}>
            <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD}>
              <h2 className={HEADING_CLASS}>{view.heading}</h2>
              <p className={EXPLANATION_CLASS}>{view.explanation}</p>
              {settingsHint}
              {errorMessage}
            </Card>
            <RunEscalation key={view.runId} runId={view.runId} />
            <AgentTranscript
              transcript={view.transcript}
              isStreaming={false}
              tailLineCount={view.tailLineCount}
            />
          </div>
        );
      }
      default:
        return assertNever(view);
    }
  })();

  return (
    <section aria-label={SECTION_LABEL} className={SECTION_CLASS}>
      <header className="flex items-center gap-2">
        {stateBadge}
        {meta}
        <Button
          variant={BUTTON_VARIANT.GHOST}
          size={BUTTON_SIZE.SM}
          className="ml-auto"
          isExpanded={isVerbose}
          title={VERBOSITY_TITLE}
          onClick={onToggleVerbosityClick}
        >
          {verbosityLabel}
        </Button>
      </header>
      {content}
    </section>
  );
}
