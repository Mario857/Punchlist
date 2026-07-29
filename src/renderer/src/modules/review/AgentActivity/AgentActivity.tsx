import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { AgentTranscript } from '@renderer/modules/review/AgentTranscript/AgentTranscript';
import { useAgentActivity } from '@renderer/modules/review/AgentActivity/useAgentActivity';

export interface AgentActivityProps {
  transcript: string;
  /** Which phase of a run this is — queued, running — worded by the caller. */
  headline: string;
}

const STATUS_ROW_CLASS = 'text-muted flex items-center gap-1.5 text-xs';
/** Two lines at most: the activity is a pulse, not a paragraph. */
const ACTIVITY_CLASS = 'text-ink line-clamp-2 text-xs leading-relaxed break-words';
const PROGRESS_CLASS = 'text-muted text-xs tabular-nums';
const META_ROW_CLASS = 'flex items-center gap-2';

/**
 * A run in flight, reported the way Cursor reports one: the current action and a
 * running count, with the full log behind one click instead of scrolling by default.
 */
export function AgentActivity({ transcript, headline }: AgentActivityProps) {
  const { activityLabel, progressLabel, isLogOpen, logToggleLabel, onToggleLogClick } =
    useAgentActivity({ transcript, headline });

  const activity =
    activityLabel === null ? null : <p className={ACTIVITY_CLASS}>{activityLabel}</p>;

  const progress =
    progressLabel === null ? null : <span className={PROGRESS_CLASS}>{progressLabel}</span>;

  const log = isLogOpen ? <AgentTranscript transcript={transcript} isStreaming /> : null;

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.SM} className="flex flex-col gap-2">
      <p role="status" className={STATUS_ROW_CLASS}>
        <Spinner size={SPINNER_SIZE.SM} label={headline} />
        {headline}
      </p>
      {activity}
      <div className={META_ROW_CLASS}>
        {progress}
        <Button
          variant={BUTTON_VARIANT.GHOST}
          size={BUTTON_SIZE.SM}
          className="ml-auto"
          isExpanded={isLogOpen}
          onClick={onToggleLogClick}
        >
          {logToggleLabel}
        </Button>
      </div>
      {log}
    </Card>
  );
}
