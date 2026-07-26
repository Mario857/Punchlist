import { z } from 'zod';

/**
 * A repo rule promotes to global on its **second repo**, which is the same
 * promote-on-second-consumer rule the renderer layers use, applied to knowledge
 * instead of code. Nothing is born global: one repo's convention is not evidence of
 * a personal preference.
 */
export const CONVENTION_SCOPE = {
  REPO: 'repo',
  GLOBAL: 'global',
} as const;

export type ConventionScope = (typeof CONVENTION_SCOPE)[keyof typeof CONVENTION_SCOPE];

/** Categories exist because the export target has sections; grouping is modelled, not reinvented. */
export const CONVENTION_CATEGORY = {
  NAMING: 'naming',
  STRUCTURE: 'structure',
  TYPING: 'typing',
  TESTING: 'testing',
  STYLING: 'styling',
  PROCESS: 'process',
  SECURITY: 'security',
} as const;

export type ConventionCategory = (typeof CONVENTION_CATEGORY)[keyof typeof CONVENTION_CATEGORY];

export const CONVENTION_STATE = {
  /** Below the recurrence threshold, or above it and not yet looked at. */
  CANDIDATE: 'candidate',
  CONFIRMED: 'confirmed',
  /** Persisted, not deleted: otherwise every distillation re-proposes the same noise. */
  REJECTED: 'rejected',
  EXPORTED: 'exported',
} as const;

export type ConventionState = (typeof CONVENTION_STATE)[keyof typeof CONVENTION_STATE];

/**
 * A single comment kept as evidence. The body is retained because distillation needs
 * it — which makes this exactly as sensitive as an agent transcript: it can quote
 * repository contents, so it is stored and rendered but never written to a log.
 */
export const conventionEvidenceSchema = z.object({
  commentId: z.string(),
  repoKey: z.string(),
  prNumber: z.number().int().positive(),
  url: z.string(),
  author: z.string(),
  body: z.string(),
  /** The file the comment was anchored to, when it had one. */
  path: z.string().nullable().default(null),
  capturedAt: z.string(),
  /** Set once distillation has read it, so a batch never re-reads the same evidence. */
  isDistilled: z.boolean().default(false),
});

export type ConventionEvidence = z.infer<typeof conventionEvidenceSchema>;

export const conventionRuleSchema = z.object({
  id: z.string(),
  scope: z.enum(CONVENTION_SCOPE),
  /** Null exactly when the scope is global. */
  repoKey: z.string().nullable().default(null),
  category: z.enum(CONVENTION_CATEGORY),
  /** Imperative mood, one rule per record. */
  rule: z.string(),
  rationale: z.string(),
  /** The comments that back it, which is what makes recurrence countable. */
  evidenceCommentIds: z.array(z.string()).default([]),
  /** Every repo the rule has been seen in; a second one is what promotes it. */
  evidenceRepoKeys: z.array(z.string()).default([]),
  state: z.enum(CONVENTION_STATE),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ConventionRule = z.infer<typeof conventionRuleSchema>;

/**
 * A single comment is one reviewer's opinion; the same instruction three times is a
 * convention. Deliberately arithmetic rather than a judgement handed to the model:
 * asking an LLM "is this rule important?" produces a confident answer with no
 * grounding, while counting how often reviewers actually said it produces a
 * defensible one. The model's job is to phrase and cluster, not to decide what matters.
 */
export const CONFIRMABLE_EVIDENCE_THRESHOLD = 3;

/** Promotion to global happens on the second repo, never the first. */
export const GLOBAL_PROMOTION_REPO_THRESHOLD = 2;

export function isConfirmable(rule: ConventionRule): boolean {
  return rule.evidenceCommentIds.length >= CONFIRMABLE_EVIDENCE_THRESHOLD;
}

export function shouldPromoteToGlobal(rule: ConventionRule): boolean {
  return rule.evidenceRepoKeys.length >= GLOBAL_PROMOTION_REPO_THRESHOLD;
}

export interface ConventionExportPreview {
  /** The repo file that would be written, and what it would contain. */
  repoFilePath: string;
  repoFileContent: string;
  /** The user-level file for global rules; the app never edits their own CLAUDE.md. */
  globalFilePath: string;
  globalFileContent: string;
  ruleCount: number;
}

export interface ExportConventionsRequest {
  repoKey: string;
  isConfirmedByUser: boolean;
}
