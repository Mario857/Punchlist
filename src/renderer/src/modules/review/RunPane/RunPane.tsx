import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { StateBadge } from '@renderer/components/StateBadge';
import { assertNever } from '@renderer/lib/assertNever';
import { AgentTranscript } from '@renderer/modules/review/AgentTranscript/AgentTranscript';
import { DecisionPrompt } from '@renderer/modules/review/DecisionPrompt/DecisionPrompt';
import { DiffReview } from '@renderer/modules/review/DiffReview/DiffReview';
import { RunEscalation } from '@renderer/modules/review/RunPane/components/RunEscalation/RunEscalation';
import { RUN_PANE_VIEW_KIND, useRunPane } from '@renderer/modules/review/RunPane/useRunPane';

export interface RunPaneProps {
  /** The pane resolves its own run from the store; null is the no-selection state. */
  commentId: string | null;
}

const SECTION_LABEL = 'Run';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted mt-1 text-xs leading-relaxed';
const HEADLINE_CLASS = 'text-muted text-xs leading-relaxed';
const EMPTY_STATE_CLASS = 'text-muted grid flex-1 place-items-center p-6 text-center text-sm';
const ERROR_MESSAGE_CLASS = 'text-danger mt-2 font-mono text-xs break-words';
const COLUMN_CLASS = 'flex min-h-0 flex-1 flex-col gap-2';

/**
 * The state-dependent right pane. The branch is a named `const` over a discriminated
 * view computed in `useRunPane`, so markup stays a mapping from view kind to surface
 * and the `RunState` exhaustiveness check lives in one place.
 */
export function RunPane({ commentId }: RunPaneProps) {
  const { view, runState, metaLabel } = useRunPane(commentId);

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
      case RUN_PANE_VIEW_KIND.DIFF:
        return (
          <DiffReview
            key={view.runId}
            runId={view.runId}
            revisionProgressLabel={view.revisionProgressLabel}
          />
        );
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
    <section aria-label={SECTION_LABEL} className="flex h-full min-h-0 flex-col gap-2 p-3">
      <header className="flex items-center gap-2">
        {stateBadge}
        {meta}
      </header>
      {content}
    </section>
  );
}
