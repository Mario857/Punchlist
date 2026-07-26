import { useMemo } from 'react';
import {
  GUARDRAIL_FLAG_KIND,
  selectUnacknowledgedFlags,
  type GuardrailFlag,
  type GuardrailFlagKind,
} from '@shared/guardrails';
import { assertNever } from '@renderer/lib/assertNever';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useRun } from '@renderer/stores/runStore';
import { useExecuteAcknowledgeGuardrail } from '@renderer/modules/runs/useQueryRuns';

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
  isAcknowledged: boolean;
  /**
   * Names the specific flag rather than reading "Acknowledge", and it is the button's
   * visible text so the accessible name identifies which flag without a second string.
   */
  acknowledgeLabel: string;
  onAcknowledgeClick: () => void;
}

interface UseGuardrailFlagsResult {
  heading: string;
  explanation: string;
  items: GuardrailFlagItem[];
  /** Says what is still outstanding, because that is what gates approval. */
  statusLabel: string;
  isAcknowledgePending: boolean;
  acknowledgeErrorMessage: string | null;
}

const HEADING = 'Flagged for acknowledgement';

/**
 * Deliberately not error copy. A review comment can legitimately ask for a change that
 * touches a flagged file, so the patch is shown rather than refused — the acknowledgement
 * only records that the decision was made knowingly.
 */
const EXPLANATION =
  'None of these block the patch and none of them mean something went wrong. They are the things worth deciding on deliberately, so approving this patch stays available once each one is acknowledged.';

const PROTECTED_PATH_LABEL = 'Protected path';
const PROTECTED_PATH_SUBJECT = 'protected path';
const PROTECTED_PATH_REASON =
  'Lock files, generated output, CI workflows, env files, vendored trees and rule files change through a package manager, a generator or a deliberate human edit — not through an agent resolving a comment. A comment asking you to bump a dependency is a perfectly good reason to see this one.';

const SECRET_LIKE_LABEL = 'Credential-shaped content';
const SECRET_LIKE_SUBJECT = 'credential-shaped content';
const SECRET_LIKE_REASON =
  'Something in the patch has the shape of a token, a private key block or a secret-named literal. Pattern scanning has both false positives and blind spots, so this is a prompt to look rather than a verdict.';

const SCOPE_MISMATCH_LABEL = 'Larger than the comment asked for';
const SCOPE_MISMATCH_SUBJECT = 'scope mismatch';
const SCOPE_MISMATCH_REASON =
  'The comment was routed as a small mechanical change and the patch is far bigger than that. Knowing before you start reading is the point — a rename that rewrites forty files is not a rename.';

const OUT_OF_ANCHOR_PATH_LABEL = 'Outside the comment’s file';
const OUT_OF_ANCHOR_PATH_SUBJECT = 'out-of-anchor path';
const OUT_OF_ANCHOR_PATH_REASON =
  'The comment is anchored to one file and the patch touches others. That can be correct — callers move with a rename — but it is not what the comment literally asked for.';

const ACKNOWLEDGE_PREFIX = 'Acknowledge ';
const ACKNOWLEDGE_PATH_PREFIX = ' on ';
const NO_PATH_SUFFIX = '';

const ALL_ACKNOWLEDGED_STATUS =
  'Every flag here is acknowledged, so none of them is holding this patch back.';
const SINGLE_OUTSTANDING_STATUS = '1 flag still to acknowledge before this patch can be approved.';
const OUTSTANDING_STATUS_SUFFIX = ' flags still to acknowledge before this patch can be approved.';

const ACKNOWLEDGE_ERROR_FALLBACK = 'Could not record that acknowledgement.';

const NO_FLAGS_OUTSTANDING = 0;
const SINGLE_FLAG_OUTSTANDING = 1;

const NO_FLAGS: readonly GuardrailFlag[] = [];
const NO_ACKNOWLEDGED_IDS: readonly string[] = [];

interface GuardrailFlagCopy {
  kindLabel: string;
  subject: string;
  reason: string;
}

/**
 * Exhausted with `assertNever` so a new guardrail kind is a compile error here rather
 * than an unexplained row the user is asked to accept on trust.
 */
function toFlagCopy(kind: GuardrailFlagKind): GuardrailFlagCopy {
  switch (kind) {
    case GUARDRAIL_FLAG_KIND.PROTECTED_PATH:
      return {
        kindLabel: PROTECTED_PATH_LABEL,
        subject: PROTECTED_PATH_SUBJECT,
        reason: PROTECTED_PATH_REASON,
      };
    case GUARDRAIL_FLAG_KIND.SECRET_LIKE:
      return {
        kindLabel: SECRET_LIKE_LABEL,
        subject: SECRET_LIKE_SUBJECT,
        reason: SECRET_LIKE_REASON,
      };
    case GUARDRAIL_FLAG_KIND.SCOPE_MISMATCH:
      return {
        kindLabel: SCOPE_MISMATCH_LABEL,
        subject: SCOPE_MISMATCH_SUBJECT,
        reason: SCOPE_MISMATCH_REASON,
      };
    case GUARDRAIL_FLAG_KIND.OUT_OF_ANCHOR_PATH:
      return {
        kindLabel: OUT_OF_ANCHOR_PATH_LABEL,
        subject: OUT_OF_ANCHOR_PATH_SUBJECT,
        reason: OUT_OF_ANCHOR_PATH_REASON,
      };
    default:
      return assertNever(kind);
  }
}

function buildAcknowledgeLabel(subject: string, path: string | null): string {
  const pathSuffix = path === null ? NO_PATH_SUFFIX : `${ACKNOWLEDGE_PATH_PREFIX}${path}`;
  return `${ACKNOWLEDGE_PREFIX}${subject}${pathSuffix}`;
}

function buildStatusLabel(outstandingCount: number): string {
  if (outstandingCount === NO_FLAGS_OUTSTANDING) return ALL_ACKNOWLEDGED_STATUS;
  if (outstandingCount === SINGLE_FLAG_OUTSTANDING) return SINGLE_OUTSTANDING_STATUS;
  return `${outstandingCount}${OUTSTANDING_STATUS_SUFFIX}`;
}

/**
 * Acknowledged flags stay in the list rather than disappearing: the record of what was
 * accepted is the reason the check exists at all.
 */
export function useGuardrailFlags({ runId }: UseGuardrailFlagsOptions): UseGuardrailFlagsResult {
  const run = useRun(runId);
  const { acknowledgeGuardrail, isAcknowledgeGuardrailPending, acknowledgeGuardrailError } =
    useExecuteAcknowledgeGuardrail();

  // Dismissing a run drops it from the store while its pane is still mounted, so a
  // missing record reads as nothing to acknowledge rather than as a crash.
  const flags = isDefined(run) ? run.guardrailFlags : NO_FLAGS;
  const acknowledgedIds = isDefined(run) ? run.acknowledgedGuardrailIds : NO_ACKNOWLEDGED_IDS;

  const items = useMemo(
    () =>
      flags.map((flag) => {
        const { kindLabel, subject, reason } = toFlagCopy(flag.kind);
        return {
          id: flag.id,
          kindLabel,
          reason,
          path: flag.path,
          detail: flag.detail,
          isAcknowledged: acknowledgedIds.includes(flag.id),
          acknowledgeLabel: buildAcknowledgeLabel(subject, flag.path),
          onAcknowledgeClick: () => acknowledgeGuardrail({ runId, flagId: flag.id }),
        };
      }),
    [acknowledgeGuardrail, acknowledgedIds, flags, runId],
  );

  const outstandingCount = selectUnacknowledgedFlags(flags, acknowledgedIds).length;

  const acknowledgeErrorMessage = (() => {
    if (!isDefined(acknowledgeGuardrailError)) return null;
    return isIpcError(acknowledgeGuardrailError)
      ? acknowledgeGuardrailError.message
      : ACKNOWLEDGE_ERROR_FALLBACK;
  })();

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    items,
    statusLabel: buildStatusLabel(outstandingCount),
    isAcknowledgePending: isAcknowledgeGuardrailPending,
    acknowledgeErrorMessage,
  };
}
