import { z } from 'zod';

/**
 * A small closed set. There is deliberately no score and no confidence value, for
 * the same reason the tier heuristic has none: a number would imply a precision a
 * language model's judgement does not have.
 */
export const OPINION_VERDICT = {
  /** The patch does what the comment asked. */
  ADDRESSES: 'addresses',
  /** It does part of it, or does it in a way that leaves something undone. */
  PARTIAL: 'partial',
  /** It does not do what was asked, whatever else it does. */
  MISSES: 'misses',
  /** It does something actively wrong — a regression, a broken contract, a leak. */
  HARMFUL: 'harmful',
} as const;

export type OpinionVerdict = (typeof OPINION_VERDICT)[keyof typeof OPINION_VERDICT];

/**
 * `.punchlist/opinion.json`, written by the reviewing agent. Untrusted like every
 * other agent-written file: a malformed one degrades to "no opinion available"
 * rather than crashing anything.
 */
export const opinionFileSchema = z.object({
  verdict: z.enum(OPINION_VERDICT),
  /** Plain prose, one per concern. Empty is a legitimate answer for `addresses`. */
  concerns: z.array(z.string()).default([]),
});

export type OpinionFile = z.infer<typeof opinionFileSchema>;

export const secondOpinionSchema = z.object({
  verdict: z.enum(OPINION_VERDICT),
  concerns: z.array(z.string()).default([]),
  reviewedAt: z.string(),
  /** Which model gave it, so a disagreement can be weighed against its source. */
  model: z.string().nullable().default(null),
  isPoolSpending: z.boolean().default(false),
  /**
   * The reviewer was told to inspect and change nothing. A prompt is a request, so
   * the patch is compared afterwards and this records whether it was obeyed. An
   * agent ignoring an explicit instruction is worth knowing about regardless of
   * what it wrote, so this is surfaced rather than quietly reverted.
   */
  didModifyPatch: z.boolean().default(false),
});

export type SecondOpinion = z.infer<typeof secondOpinionSchema>;

/**
 * Whether a verdict is one the reader should slow down for. Advisory only — a second
 * opinion never blocks approval, because a confidently wrong model given veto power
 * over your reading of the diff would be worse than no second opinion at all.
 */
export function isDissentingVerdict(verdict: OpinionVerdict): boolean {
  return verdict !== OPINION_VERDICT.ADDRESSES;
}
