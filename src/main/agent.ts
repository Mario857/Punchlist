// A static import from the CJS main process, not `import()`: @cursor/sdk ships a CJS
// build behind the `require` condition in its exports map, so the ESM-only carve-out in
// the no-dynamic-imports rule does not apply here.
import { Agent, CursorAgentError } from '@cursor/sdk';
import type {
  AgentOptions,
  Run,
  RunOperation,
  RunResultStatus,
  SDKAgent,
  SDKMessage,
  TextBlock,
  ToolUseBlock,
} from '@cursor/sdk';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import { isPoolSpending, type ResolvedModel } from '@shared/models';
import { FAILURE_REASON, type FailureReason } from '@shared/runState';
import { toModelSelection } from './router';
import { getCursorApiKey, getRunById, upsertRun } from './store';

const AGENT_LOG_SCOPE = '[agent]';

/** Surfaced as the agent's title in `Agent.list()`, so a stray agent is identifiable. */
const AGENT_NAME = 'Punchlist';

/** Plan mode produces a plan and no edits, which is not what a run is for. */
const AGENT_MODE_AGENT = 'agent';

const MINUTE_MS = 60_000;
const RUN_TIMEOUT_MINUTES = 15;

/**
 * The per-run maximum duration. Exceeding it cancels the run and fails it with
 * `TIMEOUT` rather than `AGENT_ERROR`, because the remedy differs: a timeout is worth
 * retrying, an agent error is worth reading the transcript for.
 *
 * Enforced here, where the run is awaited, so queue.ts imports this rather than
 * restating the number.
 */
export const RUN_TIMEOUT_MS = RUN_TIMEOUT_MINUTES * MINUTE_MS;

const RUN_OPERATION = {
  STREAM: 'stream',
  CANCEL: 'cancel',
} as const satisfies Record<string, RunOperation>;

const RUN_RESULT_STATUS = {
  FINISHED: 'finished',
  ERROR: 'error',
  CANCELLED: 'cancelled',
} as const satisfies Record<string, RunResultStatus>;

const SDK_MESSAGE_TYPE = {
  ASSISTANT: 'assistant',
  THINKING: 'thinking',
  TOOL_CALL: 'tool_call',
  TASK: 'task',
} as const;

const SDK_BLOCK_TYPE = {
  TEXT: 'text',
  TOOL_USE: 'tool_use',
} as const;

const TRANSCRIPT_LINE_SEPARATOR = '\n';
const THINKING_LABEL = '[thinking]';
const TOOL_CALL_LABEL = '[tool]';
const TASK_LABEL = '[task]';

const REDACTED_PLACEHOLDER = '[redacted]';

const MISSING_API_KEY_MESSAGE =
  'No Cursor API key is set. Paste the key from cursor.com/settings into Settings.';
const START_FAILURE_FALLBACK_MESSAGE = 'The Cursor agent could not be started.';
const AGENT_ERROR_FALLBACK_MESSAGE = 'The agent reported an error without a message.';
const CANCELLED_MESSAGE = 'The run was cancelled.';
const TIMEOUT_MESSAGE = `The run exceeded its ${RUN_TIMEOUT_MINUTES}-minute limit and was cancelled.`;

export const AGENT_OUTCOME_KIND = {
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type AgentOutcomeKind = (typeof AGENT_OUTCOME_KIND)[keyof typeof AGENT_OUTCOME_KIND];

interface AgentOutcomeBase {
  /** null only when the agent was never created, which is the `startFailed` case. */
  agentId: string | null;
  model: string | null;
  isPoolSpending: boolean;
  /**
   * Accumulated for persistence by the caller. A transcript can quote repository
   * contents, so it is rendered in the UI and never written to a log file.
   */
  transcript: string;
  durationMs: number;
}

/**
 * A discriminated union rather than an outcome with optional failure fields, so
 * "a completed run has no failure reason" is a compiler guarantee. The candidate diff
 * is deliberately absent: reading the worktree is sandbox.ts's job, not the runner's.
 */
export type AgentRunOutcome =
  | (AgentOutcomeBase & {
      kind: typeof AGENT_OUTCOME_KIND.COMPLETED;
      /** The agent's closing message, when the SDK reported one. */
      resultText: string | null;
    })
  | (AgentOutcomeBase & {
      kind: typeof AGENT_OUTCOME_KIND.FAILED;
      reason: FailureReason;
      errorMessage: string;
    });

interface AgentTurnBase {
  worktreePath: string;
  message: string;
  /**
   * Resolved by router.ts and handed in, never chosen here. Which model a tier maps to
   * and which lane it bills against is a routing and cost decision; this module only
   * spends what it is given, and reports back what that was.
   */
  model: ResolvedModel;
  /**
   * Injected so the orchestrator owns transport: this module never imports ipc.ts or
   * BrowserWindow, and streaming stays a callback rather than a channel.
   */
  onTranscriptChunk: (chunk: string) => void;
  /** Aborting cancels the run, which reports as `CANCELLED`. */
  signal: AbortSignal;
}

export interface AgentRunRequest extends AgentTurnBase {
  /** The record whose `agentId` is written before the run does any work. */
  runId: string;
}

export interface AgentResumeRequest extends AgentTurnBase {
  agentId: string;
}

const AGENT_START_MODE = {
  CREATE: 'create',
  RESUME: 'resume',
} as const;

type AgentStart =
  | { mode: typeof AGENT_START_MODE.CREATE; runId: string }
  | { mode: typeof AGENT_START_MODE.RESUME; agentId: string };

interface StartedAgentTurn {
  agent: SDKAgent;
  run: Run;
}

interface DrivenRun {
  status: RunResultStatus;
  resultText: string | null;
  errorMessage: string | null;
  isTimedOut: boolean;
}

/**
 * An SDK error message can quote the credential it rejected, and this message is
 * persisted to the run record and rendered in the UI, so the key is stripped on the
 * way out. Logs get an error's class name only, never its message, for the same reason.
 */
function redactApiKey(text: string, apiKey: string): string {
  return text.split(apiKey).join(REDACTED_PLACEHOLDER);
}

function describeErrorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function toFailureMessage(error: unknown, apiKey: string, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  return redactApiKey(trimmed.length === 0 ? fallback : trimmed, apiKey);
}

function toStartFailureMessage(error: unknown, apiKey: string): string {
  const message = toFailureMessage(error, apiKey, START_FAILURE_FALLBACK_MESSAGE);
  // CursorAgentError carries the SDK's stable code, and for an auth or config failure
  // that code is what makes the difference between remediations legible.
  if (error instanceof CursorAgentError && error.code !== undefined) {
    return `${message} (code: ${error.code})`;
  }
  return message;
}

function elapsedMs(startedAtMs: number): number {
  return Date.now() - startedAtMs;
}

function persistAgentStart(runId: string, agentId: string, model: ResolvedModel): void {
  const run = getRunById(runId);
  if (run === null) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `Run ${runId} is not in the store, so its agent id cannot be recorded.`,
    );
  }

  upsertRun({
    ...run,
    agentId,
    model: model.modelId,
    isPoolSpending: isPoolSpending(model.lane),
    updatedAt: new Date().toISOString(),
  });
}

async function disposeAgent(agent: SDKAgent): Promise<void> {
  // Every agent holds a child process, and with parallel runs plus a user who cancels
  // freely those leak fast, so disposal is unconditional. try/finally rather than
  // `await using` so it does not depend on the bundler lowering explicit resource
  // management for Electron's Node runtime. A failed disposal must not mask the run's
  // own outcome, so it is logged rather than thrown.
  try {
    await agent[Symbol.asyncDispose]();
  } catch (error: unknown) {
    console.warn(AGENT_LOG_SCOPE, 'Disposing the agent failed.', describeErrorKind(error));
  }
}

async function createOrResumeAgent(
  start: AgentStart,
  worktreePath: string,
  apiKey: string,
  model: ResolvedModel,
): Promise<SDKAgent> {
  const options: AgentOptions = {
    apiKey,
    model: toModelSelection(model),
    name: AGENT_NAME,
    mode: AGENT_MODE_AGENT,
    // An empty `settingSources` keeps ambient user, project and team settings out of
    // the run: containment, not configuration. `cwd` is the worktree, never the clone.
    local: { cwd: worktreePath, settingSources: [] },
  };

  if (start.mode === AGENT_START_MODE.RESUME) {
    // Inline MCP servers are never persisted with the agent, so anything handed to
    // Agent.create has to be handed to Agent.resume again. Punchlist passes none today;
    // adding one means adding it at both call sites.
    return Agent.resume(start.agentId, options);
  }

  return Agent.create(options);
}

async function startAgentTurn(
  start: AgentStart,
  turn: AgentTurnBase,
  apiKey: string,
): Promise<StartedAgentTurn> {
  const agent = await createOrResumeAgent(start, turn.worktreePath, apiKey, turn.model);

  try {
    if (start.mode === AGENT_START_MODE.CREATE) {
      // Written before the run does any work: answering a decision after an app
      // restart goes through Agent.resume, which needs this id to exist.
      persistAgentStart(start.runId, agent.agentId, turn.model);
    }

    // Agent.create + agent.send, never Agent.prompt: prompt disposes the agent on
    // return, and revisions and decision replies both need the same conversation.
    const run = await agent.send(turn.message);
    return { agent, run };
  } catch (error: unknown) {
    // The agent already holds a child process, so a failure between creating it and
    // getting a run back still has to dispose it before the error propagates.
    await disposeAgent(agent);
    throw error;
  }
}

function toBlockLine(block: TextBlock | ToolUseBlock): string {
  return block.type === SDK_BLOCK_TYPE.TEXT ? block.text : `${TOOL_CALL_LABEL} ${block.name}`;
}

function formatTranscriptLine(label: string, text: string): string {
  return `${label} ${text}${TRANSCRIPT_LINE_SEPARATOR}`;
}

function toTranscriptChunk(message: SDKMessage): string | null {
  switch (message.type) {
    case SDK_MESSAGE_TYPE.ASSISTANT: {
      const lines = message.message.content.map(toBlockLine).filter((line) => line.length > 0);
      if (lines.length === 0) return null;
      return `${lines.join(TRANSCRIPT_LINE_SEPARATOR)}${TRANSCRIPT_LINE_SEPARATOR}`;
    }
    case SDK_MESSAGE_TYPE.THINKING:
      return formatTranscriptLine(THINKING_LABEL, message.text);
    case SDK_MESSAGE_TYPE.TOOL_CALL:
      // Tool arguments and results are dropped on purpose: they quote file contents,
      // and the transcript is persisted and shown.
      return formatTranscriptLine(TOOL_CALL_LABEL, `${message.name} (${message.status})`);
    case SDK_MESSAGE_TYPE.TASK:
      return message.text === undefined ? null : formatTranscriptLine(TASK_LABEL, message.text);
    default:
      // SDKMessage belongs to the SDK and gains members between versions, so an
      // unrecognised kind is skipped rather than made a compile error here.
      return null;
  }
}

async function cancelRunIfSupported(run: Run): Promise<void> {
  // Cancellation is optional per run shape, so it is asked about rather than assumed.
  if (!run.supports(RUN_OPERATION.CANCEL)) {
    console.warn(AGENT_LOG_SCOPE, 'This run does not support cancellation; letting it finish.');
    return;
  }

  try {
    await run.cancel();
  } catch (error: unknown) {
    // Losing the cancel is not fatal: the outcome is still classified below and the
    // agent is disposed either way.
    console.warn(AGENT_LOG_SCOPE, 'Cancelling the run failed.', describeErrorKind(error));
  }
}

async function driveRun(
  run: Run,
  appendTranscript: (chunk: string) => void,
  signal: AbortSignal,
  apiKey: string,
): Promise<DrivenRun> {
  let isTimedOut = false;
  const requestCancel = (): void => {
    void cancelRunIfSupported(run);
  };

  // A timeout is enforced by cancelling, so the run comes back as `cancelled` either
  // way; this flag is what keeps the two apart when the outcome is classified.
  const timeoutTimer = setTimeout(() => {
    isTimedOut = true;
    requestCancel();
  }, RUN_TIMEOUT_MS);

  signal.addEventListener('abort', requestCancel, { once: true });
  if (signal.aborted) requestCancel();

  try {
    // A run shape without streaming still produces a result, so the transcript is
    // optional where the result is not.
    if (run.supports(RUN_OPERATION.STREAM)) {
      for await (const message of run.stream()) {
        const chunk = toTranscriptChunk(message);
        if (chunk !== null) appendTranscript(chunk);
      }
    }

    const result = await run.wait();
    return {
      status: result.status,
      resultText: result.result ?? null,
      errorMessage: result.error === undefined ? null : redactApiKey(result.error.message, apiKey),
      isTimedOut,
    };
  } finally {
    clearTimeout(timeoutTimer);
    signal.removeEventListener('abort', requestCancel);
  }
}

async function runAgentTurn(turn: AgentTurnBase, start: AgentStart): Promise<AgentRunOutcome> {
  const startedAtMs = Date.now();
  let transcript = '';
  const appendTranscript = (chunk: string): void => {
    transcript += chunk;
    turn.onTranscriptChunk(chunk);
  };

  const apiKey = getCursorApiKey();
  if (apiKey === null) {
    return {
      kind: AGENT_OUTCOME_KIND.FAILED,
      agentId: null,
      model: turn.model.modelId,
      isPoolSpending: isPoolSpending(turn.model.lane),
      transcript,
      durationMs: elapsedMs(startedAtMs),
      reason: FAILURE_REASON.START_FAILED,
      errorMessage: MISSING_API_KEY_MESSAGE,
    };
  }

  let started: StartedAgentTurn;
  try {
    started = await startAgentTurn(start, turn, apiKey);
  } catch (error: unknown) {
    // Thrown before a run exists — a CursorAgentError for auth or config, a model that
    // has left the account — means the run never started. That is a settings prompt in
    // the UI, which is why it is a different reason from a run that started and failed.
    console.warn(AGENT_LOG_SCOPE, 'The agent never started.', describeErrorKind(error));
    return {
      kind: AGENT_OUTCOME_KIND.FAILED,
      agentId: null,
      model: turn.model.modelId,
      isPoolSpending: isPoolSpending(turn.model.lane),
      transcript,
      durationMs: elapsedMs(startedAtMs),
      reason: FAILURE_REASON.START_FAILED,
      errorMessage: toStartFailureMessage(error, apiKey),
    };
  }

  const { agent } = started;
  const identity = {
    agentId: agent.agentId,
    model: turn.model.modelId,
    isPoolSpending: isPoolSpending(turn.model.lane),
  };

  try {
    const driven = await driveRun(started.run, appendTranscript, turn.signal, apiKey);
    const failure = ((): { reason: FailureReason; errorMessage: string } | null => {
      if (driven.isTimedOut)
        return { reason: FAILURE_REASON.TIMEOUT, errorMessage: TIMEOUT_MESSAGE };
      if (driven.status === RUN_RESULT_STATUS.CANCELLED || turn.signal.aborted) {
        return { reason: FAILURE_REASON.CANCELLED, errorMessage: CANCELLED_MESSAGE };
      }
      if (driven.status === RUN_RESULT_STATUS.ERROR) {
        return {
          reason: FAILURE_REASON.AGENT_ERROR,
          errorMessage: driven.errorMessage ?? AGENT_ERROR_FALLBACK_MESSAGE,
        };
      }
      return null;
    })();

    if (failure !== null) {
      return {
        kind: AGENT_OUTCOME_KIND.FAILED,
        ...identity,
        transcript,
        durationMs: elapsedMs(startedAtMs),
        ...failure,
      };
    }

    return {
      kind: AGENT_OUTCOME_KIND.COMPLETED,
      ...identity,
      transcript,
      durationMs: elapsedMs(startedAtMs),
      resultText: driven.resultText,
    };
  } catch (error: unknown) {
    // It started and then threw: a transport failure mid-stream, or wait() rejecting.
    // The run did happen, so the transcript is the useful artefact here.
    console.warn(AGENT_LOG_SCOPE, 'The run failed after starting.', describeErrorKind(error));
    return {
      kind: AGENT_OUTCOME_KIND.FAILED,
      ...identity,
      transcript,
      durationMs: elapsedMs(startedAtMs),
      reason: FAILURE_REASON.AGENT_ERROR,
      errorMessage: toFailureMessage(error, apiKey, AGENT_ERROR_FALLBACK_MESSAGE),
    };
  } finally {
    await disposeAgent(agent);
  }
}

/** Starts a fresh agent in the run's worktree and sends it the built prompt. */
export async function executeAgentRun(request: AgentRunRequest): Promise<AgentRunOutcome> {
  return runAgentTurn(request, { mode: AGENT_START_MODE.CREATE, runId: request.runId });
}

/**
 * Backs the decision reply and the two revision entry points. All three have to reach
 * the *same* agent so it keeps the comment, the code, and what it already tried.
 */
export async function resumeAgentRun(request: AgentResumeRequest): Promise<AgentRunOutcome> {
  return runAgentTurn(request, { mode: AGENT_START_MODE.RESUME, agentId: request.agentId });
}
