import { useMemo } from 'react';
import {
  GUARDRAIL_FLAG_KIND,
  type GuardrailFlag,
  type GuardrailFlagKind,
} from '@shared/guardrails';
import { assertNever } from '@renderer/lib/assertNever';
import { isDefined } from '@renderer/lib/guards';
import { useRun } from '@renderer/stores/runStore';
import { useSessionStore } from '@renderer/stores/sessionStore';

export interface UseGuardrailFlagsOptions {
  runId: string;
}

export interface GuardrailFlagItem {
  id: string;
  kindLabel: string;
  /** Why this is worth stopping on, in the user's terms rather than the checker's. */
  reason: string;
  /** Null when the finding is about the patch as a whole rather than one file. */
  path: string | null;
  /**
   * Composed in main and already safe to display — never the matched secret itself —
   * so it is rendered as plain text and never handed to a logger.
   */
  detail: string;
}

interface UseGuardrailFlagsResult {
  heading: string;
  /** Null once the copy has been read enough times; the flags themselves never hide. */
  explanation: string | null;
  items: GuardrailFlagItem[];
}

const HEADING = 'Flagged';

/**
 * Deliberately not error copy, and deliberately not a gate. A review comment can
 * legitimately ask for a change that touches a flagged file, so the patch is shown with
 * its findings beside it — the reviewer reads both and decides. The landing preview
 * recomputes its own findings over the combined diff, and that confirmation is the one
 * that counts.
 */
const EXPLANATION =
  'None of these block anything and none of them mean something went wrong. They are the things worth reading the patch with — the landing preview re-runs its own checks before anything leaves the sandbox.';

const PROTECTED_PATH_LABEL = 'Protected path';
const PROTECTED_PATH_REASON =
  'Lock files, generated output, CI workflows, env files, vendored trees and rule files change through a package manager, a generator or a deliberate human edit — not through an agent resolving a comment. A comment asking you to bump a dependency is a perfectly good reason to see this one.';

const SECRET_LIKE_LABEL = 'Credential-shaped content';
const SECRET_LIKE_REASON =
  'Something in the patch has the shape of a token, a private key block or a secret-named literal. Pattern scanning has both false positives and blind spots, so this is a prompt to look rather than a verdict.';

const SCOPE_MISMATCH_LABEL = 'Larger than the comment asked for';
const SCOPE_MISMATCH_REASON =
  'The comment was routed as a small mechanical change and the patch is far bigger than that. Knowing before you start reading is the point — a rename that rewrites forty files is not a rename.';

const OUT_OF_ANCHOR_PATH_LABEL = 'Outside the comment’s file';
const OUT_OF_ANCHOR_PATH_REASON =
  'The comment is anchored to one file and the patch touches others. That can be correct — callers move with a rename — but it is not what the comment literally asked for.';

const NO_FLAGS: readonly GuardrailFlag[] = [];

interface GuardrailFlagCopy {
  kindLabel: string;
  reason: string;
}

/**
 * Exhausted with `assertNever` so a new guardrail kind is a compile error here rather
 * than an unexplained row the user is asked to accept on trust.
 */
function toFlagCopy(kind: GuardrailFlagKind): GuardrailFlagCopy {
  switch (kind) {
    case GUARDRAIL_FLAG_KIND.PROTECTED_PATH:
      return { kindLabel: PROTECTED_PATH_LABEL, reason: PROTECTED_PATH_REASON };
    case GUARDRAIL_FLAG_KIND.SECRET_LIKE:
      return { kindLabel: SECRET_LIKE_LABEL, reason: SECRET_LIKE_REASON };
    case GUARDRAIL_FLAG_KIND.SCOPE_MISMATCH:
      return { kindLabel: SCOPE_MISMATCH_LABEL, reason: SCOPE_MISMATCH_REASON };
    case GUARDRAIL_FLAG_KIND.OUT_OF_ANCHOR_PATH:
      return { kindLabel: OUT_OF_ANCHOR_PATH_LABEL, reason: OUT_OF_ANCHOR_PATH_REASON };
    default:
      return assertNever(kind);
  }
}

/** The findings the patch should be read with — informational, never a gate. */
export function useGuardrailFlags({ runId }: UseGuardrailFlagsOptions): UseGuardrailFlagsResult {
  const isVerbose = useSessionStore((state) => state.isRunPaneVerbose);
  const run = useRun(runId);

  // Dismissing a run drops it from the store while its pane is still mounted, so a
  // missing record reads as nothing flagged rather than as a crash.
  const flags = isDefined(run) ? run.guardrailFlags : NO_FLAGS;

  const items = useMemo(
    () =>
      flags.map((flag) => {
        const { kindLabel, reason } = toFlagCopy(flag.kind);
        return { id: flag.id, kindLabel, reason, path: flag.path, detail: flag.detail };
      }),
    [flags],
  );

  return {
    heading: HEADING,
    explanation: isVerbose ? EXPLANATION : null,
    items,
  };
}
