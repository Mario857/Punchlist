export const RUN_STATE = {
  QUEUED: 'queued',
  RUNNING: 'running',
  NEEDS_DECISION: 'needsDecision', // agent halted on ambiguity, waiting on you
  READY: 'ready', // candidate patch exists, reviewable and editable
  REVISING: 'revising', // patch exists and the agent is amending it
  NO_ACTION_NEEDED: 'noActionNeeded', // ran, produced nothing, and that was correct
  FAILED: 'failed',
  APPROVED: 'approved', // reviewed and ready to land; nothing has landed
  APPLIED: 'applied', // landed after an explicit confirmation
} as const;

export type RunState = (typeof RUN_STATE)[keyof typeof RUN_STATE];

export const MODEL_TIER = {
  MECHANICAL: 'mechanical',
  STANDARD: 'standard',
  COMPLEX: 'complex',
} as const;

export type ModelTier = (typeof MODEL_TIER)[keyof typeof MODEL_TIER];

export const RUN_TRIGGER = {
  MANUAL: 'manual',
  AUTO: 'auto',
} as const;

export type RunTrigger = (typeof RUN_TRIGGER)[keyof typeof RUN_TRIGGER];

export const REVISION_KIND = {
  AGENT_RESULT: 'agentResult',
  HAND_EDIT: 'handEdit',
  TARGETED_EDIT: 'targetedEdit',
  DECISION_CONTINUATION: 'decisionContinuation',
  FOLLOW_UP: 'followUp',
} as const;

export type RevisionKind = (typeof REVISION_KIND)[keyof typeof REVISION_KIND];

export const FAILURE_REASON = {
  AGENT_ERROR: 'agentError', // it ran and failed: result.status === 'error'
  START_FAILED: 'startFailed', // CursorAgentError: never started, auth or config
  TIMEOUT: 'timeout', // exceeded the per-run maximum duration
  WORKTREE_MISSING: 'worktreeMissing', // reconciliation found the cwd gone, so resume is impossible
  CANCELLED: 'cancelled',
} as const;

export type FailureReason = (typeof FAILURE_REASON)[keyof typeof FAILURE_REASON];

/**
 * Terminal states are the only ones whose worktree may be torn down. running,
 * revising, ready and needsDecision must survive a restart, because a local agent
 * is bound to its cwd and deleting it breaks Agent.resume.
 */
const TERMINAL_RUN_STATES: readonly RunState[] = [
  RUN_STATE.NO_ACTION_NEEDED,
  RUN_STATE.FAILED,
  RUN_STATE.APPLIED,
];

export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

export function isRunActive(state: RunState): boolean {
  return state === RUN_STATE.QUEUED || state === RUN_STATE.RUNNING || state === RUN_STATE.REVISING;
}

/** Ranked most-urgent first, so a collapsed tree node can roll up its descendants. */
const RUN_STATE_URGENCY: readonly RunState[] = [
  RUN_STATE.NEEDS_DECISION,
  RUN_STATE.FAILED,
  RUN_STATE.READY,
  RUN_STATE.REVISING,
  RUN_STATE.RUNNING,
  RUN_STATE.QUEUED,
  RUN_STATE.APPROVED,
  RUN_STATE.NO_ACTION_NEEDED,
  RUN_STATE.APPLIED,
];

export function mostUrgentRunState(states: readonly RunState[]): RunState | null {
  const found = RUN_STATE_URGENCY.find((candidate) => states.includes(candidate));
  return found ?? null;
}

/** needsDecision and a guardrail flag are the two things worth opening a subtree for. */
export function shouldAttractAttention(state: RunState): boolean {
  return state === RUN_STATE.NEEDS_DECISION || state === RUN_STATE.FAILED;
}

export function shouldSelfCollapse(state: RunState): boolean {
  return state === RUN_STATE.APPLIED || state === RUN_STATE.NO_ACTION_NEEDED;
}
