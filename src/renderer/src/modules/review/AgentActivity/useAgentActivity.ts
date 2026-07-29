import { useState } from 'react';

export interface UseAgentActivityParams {
  transcript: string;
  headline: string;
}

interface UseAgentActivityResult {
  headline: string;
  /** The one line that says what the agent is doing right now; null before any output. */
  activityLabel: string | null;
  /** "14 tool calls" — the lean measure of progress a log line cannot carry. */
  progressLabel: string | null;
  isLogOpen: boolean;
  logToggleLabel: string;
  onToggleLogClick: () => void;
}

/** These mirror what main writes into the transcript, one prefix per message kind. */
const TOOL_LINE_PREFIX = '[tool] ';
const THINKING_LINE_PREFIX = '[thinking] ';
const TASK_LINE_PREFIX = '[task] ';
const LINE_BREAK = '\n';

const RUNNING_STATUS_SUFFIX = ' (running)';
const RUNNING_TOOL_PREFIX = 'Running ';
const FINISHED_TOOL_PREFIX = 'Finished ';
/** `edit (running)` → name plus parenthesised status. */
const TOOL_STATUS_PATTERN = /^(?<name>.+?) \((?<status>[a-z_]+)\)$/;

const SINGLE_TOOL_CALL_LABEL = '1 tool call';
const TOOL_CALLS_SUFFIX = ' tool calls';
const NO_TOOL_CALLS = 0;
const SINGLE_TOOL_CALL = 1;

const SHOW_LOG_LABEL = 'Show full activity';
const HIDE_LOG_LABEL = 'Hide full activity';

function toActivityLabel(line: string): string {
  if (line.startsWith(TOOL_LINE_PREFIX)) {
    const body = line.slice(TOOL_LINE_PREFIX.length);
    const match = TOOL_STATUS_PATTERN.exec(body);
    if (match?.groups === undefined) return body;
    const prefix = body.endsWith(RUNNING_STATUS_SUFFIX)
      ? RUNNING_TOOL_PREFIX
      : FINISHED_TOOL_PREFIX;
    return `${prefix}${match.groups.name}`;
  }
  if (line.startsWith(THINKING_LINE_PREFIX)) return line.slice(THINKING_LINE_PREFIX.length);
  if (line.startsWith(TASK_LINE_PREFIX)) return line.slice(TASK_LINE_PREFIX.length);
  return line;
}

/** The last non-empty line is the present tense; everything above it is history. */
function selectCurrentLine(transcript: string): string | null {
  const lines = transcript.split(LINE_BREAK);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line.length > 0) return line;
  }
  return null;
}

function countToolCalls(transcript: string): number {
  return transcript.split(LINE_BREAK).filter((line) => line.startsWith(TOOL_LINE_PREFIX)).length;
}

function toProgressLabel(toolCallCount: number): string | null {
  if (toolCallCount === NO_TOOL_CALLS) return null;
  if (toolCallCount === SINGLE_TOOL_CALL) return SINGLE_TOOL_CALL_LABEL;
  return `${toolCallCount}${TOOL_CALLS_SUFFIX}`;
}

/**
 * The lean view of a run in flight: what the agent is doing right now and how much it
 * has done, one line each — the way Cursor reports an agent rather than a scrolling
 * log. The full transcript stays one click away, because "lean by default" must not
 * become "unknowable when it matters".
 */
export function useAgentActivity({
  transcript,
  headline,
}: UseAgentActivityParams): UseAgentActivityResult {
  // Local rather than persisted: wanting the log open is about this run, right now.
  const [isLogOpen, setIsLogOpen] = useState(false);

  const currentLine = selectCurrentLine(transcript);

  return {
    headline,
    activityLabel: currentLine === null ? null : toActivityLabel(currentLine),
    progressLabel: toProgressLabel(countToolCalls(transcript)),
    isLogOpen,
    logToggleLabel: isLogOpen ? HIDE_LOG_LABEL : SHOW_LOG_LABEL,
    onToggleLogClick: () => setIsLogOpen((isOpen) => !isOpen),
  };
}
