import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  agentDecisionSchema,
  agentSummarySchema,
  type AgentDecision,
  type AgentSummary,
} from '@shared/runs';

const DECISION_LOG_SCOPE = '[decision]';

/**
 * The agent's scratch directory inside its worktree. `.punchlist/` is already added to
 * the repository's shared .git/info/exclude by the worktree layer — one entry covers
 * every worktree through the common git dir — so nothing written here can show up in a
 * candidate diff. That exclusion is not re-done here.
 */
const PUNCHLIST_DIRECTORY_NAME = '.punchlist';
const DECISION_FILE_NAME = 'decision.json';
const SUMMARY_FILE_NAME = 'summary.json';

const FILE_ENCODING = 'utf8';
const SYSTEM_ERROR_ENOENT = 'ENOENT';
const ISSUE_PATH_SEPARATOR = '.';
const ISSUE_SEPARATOR = '; ';

/**
 * Detection is a poll on the file rather than a sentinel parsed out of the agent's
 * prose, because format compliance in prose is unreliable while a file either exists
 * or does not. A second is below the point where a halt starts to feel like a hang, and
 * far above the cost of one stat on a path that is almost always missing.
 */
export const DECISION_POLL_INTERVAL_MS = 1_000;

/**
 * A file caught mid-write parses as malformed, so one bad read is retried instead of
 * being reported as a broken halt. Only this many consecutive failures is a verdict.
 */
const MALFORMED_READ_TOLERANCE = 3;
const MALFORMED_READ_COUNT_START = 0;
const MALFORMED_READ_INCREMENT = 1;

/** Fewer than two options is nothing to choose between. */
const MIN_CHOOSABLE_OPTION_COUNT = 2;

const MALFORMED_DECISION_MESSAGE =
  'The agent halted but wrote a decision file that could not be read.';

export const DECISION_STATUS = {
  ABSENT: 'absent',
  PENDING: 'pending',
  /** The agent halted incorrectly: it stopped, but left nothing answerable behind. */
  MALFORMED: 'malformed',
} as const;

export type DecisionStatus = (typeof DECISION_STATUS)[keyof typeof DECISION_STATUS];

export type DecisionReadResult =
  | { status: typeof DECISION_STATUS.ABSENT }
  | { status: typeof DECISION_STATUS.PENDING; decision: AgentDecision }
  | { status: typeof DECISION_STATUS.MALFORMED; message: string };

export interface DecisionWatchOptions {
  worktreePath: string;
  /** Fires once; the watch has already stopped by then, so a decision is never re-raised. */
  onDecision: (decision: AgentDecision) => void;
  /** The agent halted without an answerable question — a clean state, never a crash. */
  onMalformed: (message: string) => void;
}

export interface DecisionWatch {
  /** Idempotent, so a run that ends for any other reason can always call it. */
  stop: () => void;
}

/** execFile-style errors carry `code` bolted on rather than typed, so it is parsed. */
const systemErrorSchema = z.object({ code: z.string().nullish() });

function isMissingFileError(error: unknown): boolean {
  const parsed = systemErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === SYSTEM_ERROR_ENOENT;
}

function resolvePunchlistFilePath(worktreePath: string, fileName: string): string {
  return join(worktreePath, PUNCHLIST_DIRECTORY_NAME, fileName);
}

/** Null covers both "not written yet" and "unreadable right now"; the poll retries. */
async function readPunchlistFile(worktreePath: string, fileName: string): Promise<string | null> {
  try {
    return await readFile(resolvePunchlistFilePath(worktreePath, fileName), FILE_ENCODING);
  } catch (error: unknown) {
    if (!isMissingFileError(error)) {
      // The path is logged, never the contents: an agent-written file can quote
      // repository contents.
      console.warn(DECISION_LOG_SCOPE, `${fileName} could not be read.`, error);
    }
    return null;
  }
}

function decodeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function summarizeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(ISSUE_PATH_SEPARATOR)}: ${issue.message}`)
    .join(ISSUE_SEPARATOR);
}

/**
 * The least trustworthy input in the system: an LLM wrote it. A malformed file has to
 * degrade to a reportable state and must never take the main process down with it, so
 * nothing here throws.
 */
export async function readAgentDecision(worktreePath: string): Promise<DecisionReadResult> {
  const raw = await readPunchlistFile(worktreePath, DECISION_FILE_NAME);
  if (raw === null) return { status: DECISION_STATUS.ABSENT };

  const parsed = agentDecisionSchema.safeParse(decodeJson(raw));
  if (!parsed.success) {
    // Zod issues name paths and expected types, never the offending values, so this
    // message is safe to surface and safe to log.
    return {
      status: DECISION_STATUS.MALFORMED,
      message: `${MALFORMED_DECISION_MESSAGE} ${summarizeIssues(parsed.error.issues)}`,
    };
  }

  return { status: DECISION_STATUS.PENDING, decision: parsed.data };
}

/**
 * Options are ordered best-first, which is what lets auto mode take the top one
 * meaningfully. With fewer than two there is nothing to choose between — reported here
 * as a fact so the policy for what to do about it lives with auto mode, not here.
 */
export function hasChoosableOptions(decision: AgentDecision): boolean {
  return decision.options.length >= MIN_CHOOSABLE_OPTION_COUNT;
}

/**
 * The agent's draft commit message. Missing or malformed degrades to null: landing is
 * never blocked on it, because the commit message has a template fallback.
 */
export async function readAgentSummary(worktreePath: string): Promise<AgentSummary | null> {
  const raw = await readPunchlistFile(worktreePath, SUMMARY_FILE_NAME);
  if (raw === null) return null;

  const parsed = agentSummarySchema.safeParse(decodeJson(raw));
  if (!parsed.success) {
    console.warn(
      DECISION_LOG_SCOPE,
      `${SUMMARY_FILE_NAME} has an unexpected shape; falling back to a template message.`,
      summarizeIssues(parsed.error.issues),
    );
    return null;
  }

  return parsed.data;
}

async function removePunchlistFile(worktreePath: string, fileName: string): Promise<void> {
  try {
    await rm(resolvePunchlistFilePath(worktreePath, fileName), { force: true });
  } catch (error: unknown) {
    console.warn(DECISION_LOG_SCOPE, `${fileName} could not be removed.`, error);
  }
}

/** A consumed decision must not re-trigger, so answering it deletes the file. */
export async function clearAgentDecision(worktreePath: string): Promise<void> {
  await removePunchlistFile(worktreePath, DECISION_FILE_NAME);
}

/**
 * Cleared before a revision so a stale subject cannot be reused as this revision's
 * summary if the agent finishes without rewriting the file.
 */
export async function clearAgentSummary(worktreePath: string): Promise<void> {
  await removePunchlistFile(worktreePath, SUMMARY_FILE_NAME);
}

/**
 * Polls for `.punchlist/decision.json` and stops itself the moment it has a verdict, so
 * a watcher can never outlive the run that started it. The caller stops it too on any
 * other ending — a result, a cancellation, a timeout.
 */
export function watchForDecision(options: DecisionWatchOptions): DecisionWatch {
  let isStopped = false;
  let isReading = false;
  let malformedReadCount = MALFORMED_READ_COUNT_START;

  function stop(): void {
    if (isStopped) return;
    isStopped = true;
    clearInterval(timer);
  }

  async function poll(): Promise<void> {
    // A read slower than the interval must not overlap the next tick.
    if (isStopped || isReading) return;
    isReading = true;

    try {
      const result = await readAgentDecision(options.worktreePath);
      // stop() may have landed during the await, and a stopped watch reports nothing.
      if (isStopped) return;

      if (result.status === DECISION_STATUS.ABSENT) {
        malformedReadCount = MALFORMED_READ_COUNT_START;
        return;
      }

      if (result.status === DECISION_STATUS.MALFORMED) {
        malformedReadCount += MALFORMED_READ_INCREMENT;
        if (malformedReadCount < MALFORMED_READ_TOLERANCE) return;
        stop();
        options.onMalformed(result.message);
        return;
      }

      stop();
      options.onDecision(result.decision);
    } catch (error: unknown) {
      // Nothing in a background poll may reach the process as an unhandled rejection,
      // so even a throwing callback is logged and the watch simply ends.
      stop();
      console.warn(DECISION_LOG_SCOPE, 'The decision watch stopped after a failure.', error);
    } finally {
      isReading = false;
    }
  }

  const timer = setInterval(() => {
    void poll();
  }, DECISION_POLL_INTERVAL_MS);
  // The poll must never be the thing keeping the process alive after the window closes.
  timer.unref();

  return { stop };
}
