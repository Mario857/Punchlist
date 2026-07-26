import { z } from 'zod';

/**
 * Containment stops an agent reaching the network. It says nothing about *what it
 * wrote*, which is what these cover.
 */
export const GUARDRAIL_FLAG_KIND = {
  /** Lock files, generated output, CI workflows, env files, vendored trees, rule files. */
  PROTECTED_PATH: 'protectedPath',
  /** Credential-shaped content: token prefixes, private key blocks, secret-named literals. */
  SECRET_LIKE: 'secretLike',
  /** A mechanical comment that produced a sprawling diff is not a rename. */
  SCOPE_MISMATCH: 'scopeMismatch',
  /** An anchored comment whose patch touches files unrelated to its own path. */
  OUT_OF_ANCHOR_PATH: 'outOfAnchorPath',
} as const;

export type GuardrailFlagKind = (typeof GUARDRAIL_FLAG_KIND)[keyof typeof GUARDRAIL_FLAG_KIND];

export const guardrailFlagSchema = z.object({
  /**
   * Derived from the kind and its subject rather than randomly generated, so
   * re-checking a patch produces the same id and an acknowledgement already given
   * is not silently discarded on the next revision.
   */
  id: z.string(),
  kind: z.enum(GUARDRAIL_FLAG_KIND),
  /** The file the flag is about, when it is about one. */
  path: z.string().nullable().default(null),
  /**
   * What was found, in terms safe to display. Never the matched secret itself — a
   * flag is rendered in the UI and must not become the leak it is reporting.
   */
  detail: z.string(),
});

export type GuardrailFlag = z.infer<typeof guardrailFlagSchema>;

/**
 * Flags require acknowledgement rather than blocking outright. A review comment may
 * legitimately ask you to bump a dependency, which touches a lock file; refusing
 * would make the tool fight you, while surfacing it loudly means you decide
 * knowingly. There is deliberately no severity axis — every flag is worth one
 * explicit acknowledgement, and ranking them would invite ignoring the low ones.
 */
export function hasUnacknowledgedFlags(
  flags: readonly GuardrailFlag[],
  acknowledgedIds: readonly string[],
): boolean {
  return flags.some((flag) => !acknowledgedIds.includes(flag.id));
}

export function selectUnacknowledgedFlags(
  flags: readonly GuardrailFlag[],
  acknowledgedIds: readonly string[],
): GuardrailFlag[] {
  return flags.filter((flag) => !acknowledgedIds.includes(flag.id));
}
