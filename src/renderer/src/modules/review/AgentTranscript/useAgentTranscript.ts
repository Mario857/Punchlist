import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface UseAgentTranscriptOptions {
  transcript: string;
  isStreaming: boolean;
  /** Only the tail is useful after a failure; null renders everything. */
  tailLineCount?: number | null;
}

interface UseAgentTranscriptResult {
  scrollRef: RefObject<HTMLPreElement | null>;
  displayedTranscript: string;
  hasOutput: boolean;
  emptyStateLabel: string;
  statusLabel: string;
  isTruncated: boolean;
  truncationLabel: string;
  onScroll: () => void;
}

const LINE_SEPARATOR = '\n';
const EMPTY_LENGTH = 0;

/**
 * How close to the bottom counts as "following the output". Above that the reader has
 * scrolled back deliberately, and yanking them to the bottom on the next chunk would
 * make a streaming transcript impossible to read.
 */
const TRANSCRIPT_STICKY_THRESHOLD_PX = 48;

const STREAMING_STATUS_LABEL = 'The agent is still working.';
const IDLE_STATUS_LABEL = 'Output complete.';
const EMPTY_STREAMING_LABEL = 'Waiting for the first output from the agent…';
const EMPTY_IDLE_LABEL = 'This run produced no transcript.';
const TRUNCATION_LABEL = 'Showing the end of the transcript.';

function toTail(transcript: string, tailLineCount: number | null): string {
  if (tailLineCount === null) return transcript;
  const lines = transcript.split(LINE_SEPARATOR);
  if (lines.length <= tailLineCount) return transcript;
  return lines.slice(-tailLineCount).join(LINE_SEPARATOR);
}

/**
 * A transcript can quote repository contents, so it is rendered and nothing more:
 * it never reaches `logError` or any other log call.
 */
export function useAgentTranscript({
  transcript,
  isStreaming,
  tailLineCount = null,
}: UseAgentTranscriptOptions): UseAgentTranscriptResult {
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const isFollowingRef = useRef(true);

  const displayedTranscript = toTail(transcript, tailLineCount);
  const hasOutput = transcript.length > EMPTY_LENGTH;

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    if (!isFollowingRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [displayedTranscript]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isFollowingRef.current = distanceFromBottom <= TRANSCRIPT_STICKY_THRESHOLD_PX;
  }, []);

  return {
    scrollRef,
    displayedTranscript,
    hasOutput,
    emptyStateLabel: isStreaming ? EMPTY_STREAMING_LABEL : EMPTY_IDLE_LABEL,
    statusLabel: isStreaming ? STREAMING_STATUS_LABEL : IDLE_STATUS_LABEL,
    isTruncated: displayedTranscript.length < transcript.length,
    truncationLabel: TRUNCATION_LABEL,
    onScroll,
  };
}
