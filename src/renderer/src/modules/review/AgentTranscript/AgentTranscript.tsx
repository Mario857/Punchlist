import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { FOCUS_RING } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useAgentTranscript } from '@renderer/modules/review/AgentTranscript/useAgentTranscript';

export interface AgentTranscriptProps {
  transcript: string;
  /** Drives the live indicator; the text itself arrives through the run store. */
  isStreaming: boolean;
  /** Only the tail is useful after a failure; omit to render the whole transcript. */
  tailLineCount?: number | null;
}

const TRANSCRIPT_LABEL = 'Agent transcript';
/** A scrollable region must be reachable by keyboard, not only by wheel or trackpad. */
const TRANSCRIPT_TAB_INDEX = 0;

const TRANSCRIPT_CLASS = joinClassNames(
  'border-border bg-bg-0/60 min-h-0 flex-1 overflow-auto rounded-md border p-2',
  'font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
  'text-muted',
  FOCUS_RING,
);

const STATUS_ROW_CLASS = 'text-muted flex items-center gap-1.5 text-xs';

/**
 * A transcript is potentially sensitive — it can quote repository contents — so it is
 * displayed here and never written to a log.
 */
export function AgentTranscript({ transcript, isStreaming, tailLineCount }: AgentTranscriptProps) {
  const {
    scrollRef,
    displayedTranscript,
    hasOutput,
    emptyStateLabel,
    statusLabel,
    isTruncated,
    truncationLabel,
    onScroll,
  } = useAgentTranscript({ transcript, isStreaming, tailLineCount });

  const spinner = isStreaming ? <Spinner size={SPINNER_SIZE.SM} label={statusLabel} /> : null;
  const truncationNote = isTruncated ? <p className={STATUS_ROW_CLASS}>{truncationLabel}</p> : null;

  const body = hasOutput ? (
    <pre
      ref={scrollRef}
      tabIndex={TRANSCRIPT_TAB_INDEX}
      aria-label={TRANSCRIPT_LABEL}
      onScroll={onScroll}
      className={TRANSCRIPT_CLASS}
    >
      {displayedTranscript}
    </pre>
  ) : (
    <p className="text-muted flex-1 text-xs leading-relaxed">{emptyStateLabel}</p>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p role="status" className={STATUS_ROW_CLASS}>
        {spinner}
        {statusLabel}
      </p>
      {body}
      {truncationNote}
    </div>
  );
}
