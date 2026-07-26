import { z } from 'zod';
import { prRefSchema } from './discovery';
import { FAILURE_REASON, MODEL_TIER, RUN_STATE, RUN_TRIGGER, type ModelTier } from './runState';

/**
 * Zod 4 accepts the typed const objects directly, so these stay derived from
 * runState.ts rather than restating its literals: adding a state in one place
 * updates the schema with it.
 */
const runStateSchema = z.enum(RUN_STATE);
const modelTierSchema = z.enum(MODEL_TIER);
const runTriggerSchema = z.enum(RUN_TRIGGER);
const failureReasonSchema = z.enum(FAILURE_REASON);

/**
 * `.airlock/decision.json`, written by a halted agent. This is the least
 * trustworthy input in the system — an LLM wrote it — so a malformed file must
 * degrade to a clean "the agent halted incorrectly" state rather than crash main.
 *
 * Options are ordered best-first, which is what lets auto mode take the top one
 * meaningfully rather than arbitrarily.
 */
export const agentDecisionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  context: z.string().nullable().default(null),
});

/** `.airlock/summary.json`: the agent's draft commit message. */
export const agentSummarySchema = z.object({
  subject: z.string(),
  details: z.string().nullable().default(null),
});

export const runRecordSchema = z.object({
  id: z.string(),
  commentId: z.string(),
  prRef: prRefSchema,
  /** The local clone the worktree was created from. */
  repoPath: z.string(),
  state: runStateSchema,
  tier: modelTierSchema,
  /** Resolved at run time from Cursor.models.list(), so never a hardcoded id. */
  model: z.string().nullable().default(null),
  /** True when the selected model draws down the included pool rather than the free lane. */
  isPoolSpending: z.boolean().default(false),
  trigger: runTriggerSchema,
  worktreePath: z.string(),
  branchName: z.string(),
  /**
   * Persisted immediately after Agent.create so a decision can still be answered
   * after an app restart via Agent.resume.
   */
  agentId: z.string().nullable().default(null),
  /** Every change after the agent's first result is its own commit in the worktree. */
  revisionCount: z.number().int().nonnegative().default(0),
  failureReason: failureReasonSchema.nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  decision: agentDecisionSchema.nullable().default(null),
  summary: agentSummarySchema.nullable().default(null),
  /**
   * A transcript can quote repository contents, so it is treated as potentially
   * sensitive: rendered in the UI, never written to a log file.
   */
  transcript: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  durationMs: z.number().nonnegative().nullable().default(null),
});

export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;

export const RUN_EVENT_KIND = {
  STATE_CHANGED: 'stateChanged',
  TRANSCRIPT_APPENDED: 'transcriptAppended',
} as const;

export type RunEventKind = (typeof RUN_EVENT_KIND)[keyof typeof RUN_EVENT_KIND];

/**
 * Streamed main → renderer. A state change carries the whole record because the
 * renderer's store is a projection of main's state, not an independent copy that
 * could drift; transcript chunks are separate because they arrive continuously and
 * shipping the full record per token would be wasteful.
 */
export type RunEvent =
  | { kind: typeof RUN_EVENT_KIND.STATE_CHANGED; run: RunRecord }
  | { kind: typeof RUN_EVENT_KIND.TRANSCRIPT_APPENDED; runId: string; chunk: string };

export interface StartRunRequest {
  commentId: string;
  /** Null takes the router's heuristic tier; a value is an explicit override. */
  tier: ModelTier | null;
}

export interface ContinueRunRequest {
  runId: string;
  /** The answer to the agent's question, or the follow-up on the whole patch. */
  message: string;
}

export interface EscalateRunRequest {
  runId: string;
  /**
   * Crossing into the pool-spending lane. Never set automatically — auto-escalation
   * stays inside the unlimited lane by raising reasoning effort instead.
   */
  shouldUseFrontier: boolean;
  /**
   * Which frontier model, chosen from the live catalog. Required when
   * `shouldUseFrontier`, because picking one from a built-in preference order would
   * be the app reaching for a billable model on the user's behalf — the exact thing
   * the free-lane default exists to prevent.
   */
  frontierModelId: string | null;
  /**
   * Escalation resets the worktree to base, so hand-edits would be lost. The reset
   * refuses on a dirty worktree until this says the loss is intended.
   */
  isDiscardConfirmed: boolean;
}

/** One file in a candidate patch, as the diff viewer needs it. */
export interface CandidatePatchFile {
  path: string;
  /** Content at the worktree's base commit; empty for an added file. */
  originalContent: string;
  /** Content after the agent's work; empty for a deleted file. */
  modifiedContent: string;
}

export interface CandidatePatch {
  runId: string;
  files: CandidatePatchFile[];
  /** Empty means the run produced no changes, which is a meaningful outcome. */
  isEmpty: boolean;
}

export interface SandboxUsage {
  worktreeCount: number;
  totalBytes: number;
  /** Worktrees whose run has reached a terminal state and may be torn down. */
  reclaimableCount: number;
}
