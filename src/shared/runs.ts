import { z } from 'zod';
import { prRefSchema } from './discovery';
import { guardrailFlagSchema } from './guardrails';
import { secondOpinionSchema } from './opinion';
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
 * `.punchlist/decision.json`, written by a halted agent. This is the least
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

/** `.punchlist/summary.json`: the agent's draft commit message. */
export const agentSummarySchema = z.object({
  subject: z.string(),
  details: z.string().nullable().default(null),
});

export const autoDecisionSchema = z.object({
  question: z.string(),
  chosenOption: z.string(),
  /** Kept so review can show what was passed over, not just what was taken. */
  alternatives: z.array(z.string()),
  decidedAt: z.string(),
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
  /**
   * Set when the PR head moved after this run's worktree was created. The patch is
   * against code that is no longer current, so it is surfaced rather than silently
   * offered for landing.
   */
  isStale: z.boolean().default(false),
  /**
   * A reviewing agent's verdict on this patch, when one was asked for. Cleared by a
   * revision: an opinion is about the patch that was read, and a changed patch has
   * not been reviewed.
   */
  secondOpinion: secondOpinionSchema.nullable().default(null),
  /** Recomputed whenever the patch changes, so a revision cannot outrun its checks. */
  guardrailFlags: z.array(guardrailFlagSchema).default([]),
  /**
   * What auto mode decided on this run's behalf. Auto mode defers decisions rather
   * than hiding them: a wrong call has to surface while the diff is being reviewed
   * instead of after it lands, which it cannot do unless the alternatives are kept.
   */
  autoDecisions: z.array(autoDecisionSchema).default([]),
  /**
   * Acknowledgements survive re-checking because a flag's id is derived from what it
   * is about, so an unchanged finding stays acknowledged across revisions.
   */
  acknowledgedGuardrailIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  durationMs: z.number().nonnegative().nullable().default(null),
});

export type AutoDecision = z.infer<typeof autoDecisionSchema>;
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

export const SELECTION_SIDE = {
  /** Code the agent wrote: "change this". */
  MODIFIED: 'modified',
  /** Code the agent left alone: "you missed this". */
  ORIGINAL: 'original',
} as const;

export type SelectionSide = (typeof SELECTION_SIDE)[keyof typeof SELECTION_SIDE];

/**
 * A selection-scoped edit. The content is carried verbatim because line numbers
 * drift the moment the agent edits anything above them — the content is the anchor
 * and the range is only a hint.
 *
 * Which side the selection came from changes the instruction, not just the context,
 * which is why the side is part of the request rather than inferred later.
 */
export interface TargetedEditSelection {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  side: SelectionSide;
}

export interface ContinueRunRequest {
  runId: string;
  /** The answer to the agent's question, or the follow-up on the whole patch. */
  message: string;
  /** Present for a targeted edit; absent for a decision reply or whole-patch follow-up. */
  selection?: TargetedEditSelection | null;
}

export interface WriteRunFileRequest {
  runId: string;
  path: string;
  content: string;
}

/**
 * One commit inside the run's worktree, newest first. These are an internal audit
 * trail that gets squashed away at landing, so the subject is terse by design.
 */
export interface RunRevision {
  revision: string;
  subject: string;
  committedAt: string;
  /** The base commit the worktree was created at, which is revision zero. */
  isBase: boolean;
}

export interface RevertRunRequest {
  runId: string;
  revision: string;
  /**
   * Reverting discards every later revision, including uncommitted hand-edits, so
   * it refuses on a dirty worktree until the loss is intended.
   */
  isDiscardConfirmed: boolean;
}

export interface AcknowledgeGuardrailRequest {
  runId: string;
  flagId: string;
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
