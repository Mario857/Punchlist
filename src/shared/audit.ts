import { z } from 'zod';
import { prRefSchema } from './discovery';

/**
 * Every action taken outside the sandbox, plus the two in-sandbox decisions that
 * authorise one: a guardrail acknowledgement, and an undo. This is the history of
 * what the tool did to your repository, so it is append-only and inspectable.
 */
export const AUDIT_ACTION = {
  GUARDRAIL_ACKNOWLEDGED: 'guardrailAcknowledged',
  INTEGRATION_BRANCH_PUBLISHED: 'integrationBranchPublished',
  BRANCH_PUSHED: 'branchPushed',
  THREAD_RESOLVED: 'threadResolved',
  THREAD_UNRESOLVED: 'threadUnresolved',
  REPLY_POSTED: 'replyPosted',
  LANDING_UNDONE: 'landingUndone',
  /** The local target branch fast-forwarded to the assembled result. */
  TARGET_BRANCH_UPDATED: 'targetBranchUpdated',
  CONVENTIONS_EXPORTED: 'conventionsExported',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const auditEntrySchema = z.object({
  id: z.string(),
  action: z.enum(AUDIT_ACTION),
  at: z.string(),
  prRef: prRefSchema.nullable().default(null),
  /**
   * What was done, in terms safe to keep forever. The log records **actions, not
   * payloads**: which branch was pushed and which threads were resolved, never a
   * token, a diff, a comment body or a transcript.
   */
  summary: z.string(),
  /** The runs the action covered, so a landing can be traced back to its patches. */
  runIds: z.array(z.string()).default([]),
  /** Thread node ids, which is what unresolving them again needs. */
  threadIds: z.array(z.string()).default([]),
  branchName: z.string().nullable().default(null),
  remoteName: z.string().nullable().default(null),
  /**
   * Set on the entries belonging to one landing, so an undo can replay exactly that
   * landing in reverse rather than guessing which entries went together.
   */
  landingId: z.string().nullable().default(null),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;
