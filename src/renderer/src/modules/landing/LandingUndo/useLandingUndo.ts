import { useCallback, useState } from 'react';
import type { PrRef } from '@shared/discovery';
import type { UndoableLanding } from '@shared/landing';
import { formatDateTime } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { buildRunCountPhrase, buildThreadCountPhrase } from '@renderer/modules/landing/landingCopy';
import { useExecuteUndoLanding } from '@renderer/modules/landing/useExecuteUndoLanding';
import { useQueryUndoableLanding } from '@renderer/modules/landing/useQueryUndoableLanding';

export interface UseLandingUndoOptions {
  /** The PR on screen, whose runs return to approved when an undo succeeds. */
  prRef: PrRef | null;
}

/**
 * The five states of the reverse gate, as a discriminated union for the same reason the
 * landing view is one: a new state becomes a compile error rather than a panel that
 * silently stops offering an undo.
 */
export const LANDING_UNDO_VIEW_KIND = {
  LOADING: 'loading',
  UNAVAILABLE: 'unavailable',
  OFFERED: 'offered',
  CONFIRMING: 'confirming',
  UNDONE: 'undone',
} as const;

export type LandingUndoViewKind =
  (typeof LANDING_UNDO_VIEW_KIND)[keyof typeof LANDING_UNDO_VIEW_KIND];

export type LandingUndoView =
  | { kind: typeof LANDING_UNDO_VIEW_KIND.LOADING; loadingLabel: string }
  | { kind: typeof LANDING_UNDO_VIEW_KIND.UNAVAILABLE; unavailableLabel: string }
  | {
      kind: typeof LANDING_UNDO_VIEW_KIND.OFFERED;
      landedLabel: string;
      effectLabel: string;
      reviewLabel: string;
      onReviewClick: () => void;
    }
  | {
      kind: typeof LANDING_UNDO_VIEW_KIND.CONFIRMING;
      confirmHeading: string;
      /** The one part of a landing an undo cannot reverse, stated before the click. */
      replyWarningLabel: string;
      effectLabel: string;
      confirmLabel: string;
      keepLabel: string;
      isUndoExecuting: boolean;
      onConfirmClick: () => void;
      onKeepClick: () => void;
    }
  | {
      kind: typeof LANDING_UNDO_VIEW_KIND.UNDONE;
      undoneLabel: string;
      replyLabel: string;
    };

interface UseLandingUndoResult {
  heading: string;
  view: LandingUndoView;
  /** Always rendered: an undo is audited too, so the history never becomes clean. */
  auditNoticeLabel: string;
  errorMessage: string | null;
}

/**
 * Only a second, explicit press sends this. The first press opens the confirmation and
 * nothing more, so nothing on the way to it can carry the flag.
 */
const IS_UNDO_CONFIRMED_BY_USER = true;

const UNDO_HEADING = 'Undo the last landing';

const LOADING_LABEL = 'Checking whether the last landing is still reversible…';

/**
 * Said rather than silently hidden. A missing button teaches nothing; the reason it is
 * missing is the thing worth knowing, because the remedy is a git operation the user
 * performs themselves.
 */
const UNAVAILABLE_LABEL =
  'No landing is reversible from here right now. Undo is offered only while a landing is the most recent one — once anything has been built on top of that branch, unwinding it means deleting the pushed branch and unresolving the threads yourself, deliberately, rather than through a button that cannot see what you built.';

const AUDIT_NOTICE_LABEL =
  'An undo is itself an action taken outside the sandbox, so it is appended to the audit log exactly as the landing was. The Audit screen holds both records: undoing reverses the effects, not the history.';

const CONFIRM_HEADING = 'Confirm undoing this landing';

const REPLY_POSTED_WARNING =
  'This landing posted a reply comment on the pull request. A posted comment cannot be unposted — undo will not remove it, and the only thing that can follow it is another comment. Everything else below is reversed.';
const REPLY_ABSENT_WARNING =
  'This landing posted no reply comment, so there is nothing here that undo cannot reverse. Had it posted one, that comment could not have been unposted — a posted comment can only be followed by another comment.';

const KEEP_LABEL = 'Keep this landing';
const REVIEW_LABEL = 'Review what undoing this landing would do';

const UNDO_ERROR_FALLBACK = 'Could not undo this landing.';

const LANDED_PREFIX = 'Landed ';
const LANDED_TIME_SUFFIX = ': ';
const LANDED_PUSHED_INFIX = ' was pushed to ';
const LANDED_RESOLVED_INFIX = ' and ';
const LANDED_RESOLVED_SUFFIX = ' were resolved.';

const EFFECT_PREFIX = 'Undoing deletes ';
const EFFECT_REMOTE_INFIX = ' from ';
const EFFECT_UNRESOLVE_INFIX = ', unresolves ';
const EFFECT_RUNS_INFIX = ' and returns ';
const EFFECT_RUNS_SUFFIX = ' to approved, ready to land again.';

const CONFIRM_DELETE_PREFIX = 'Delete ';
const CONFIRM_UNRESOLVE_INFIX = ' and unresolve ';

const UNDONE_PREFIX = 'Undone. ';
const UNDONE_DELETED_INFIX = ' is deleted from ';
const UNDONE_UNRESOLVED_INFIX = ', ';
const UNDONE_UNRESOLVED_SUFFIX = ' are unresolved and ';
const UNDONE_RUNS_SUFFIX = ' are back to approved.';

const UNDONE_REPLY_POSTED_LABEL =
  'The reply comment this landing posted is still posted. It cannot be unposted; it can only be followed by another comment.';
const UNDONE_REPLY_ABSENT_LABEL =
  'This landing posted no reply comment, so nothing it did survives the undo.';

function buildLandedLabel(landing: UndoableLanding): string {
  const threadsPhrase = buildThreadCountPhrase(landing.resolvedThreadIds.length);
  return [
    `${LANDED_PREFIX}${formatDateTime(landing.at)}${LANDED_TIME_SUFFIX}`,
    `${landing.integrationBranchName}${LANDED_PUSHED_INFIX}${landing.remoteName}`,
    `${LANDED_RESOLVED_INFIX}${threadsPhrase}${LANDED_RESOLVED_SUFFIX}`,
  ].join('');
}

function buildEffectLabel(landing: UndoableLanding): string {
  const threadsPhrase = buildThreadCountPhrase(landing.resolvedThreadIds.length);
  const runsPhrase = buildRunCountPhrase(landing.runIds.length);
  return [
    `${EFFECT_PREFIX}${landing.integrationBranchName}`,
    `${EFFECT_REMOTE_INFIX}${landing.remoteName}`,
    `${EFFECT_UNRESOLVE_INFIX}${threadsPhrase}`,
    `${EFFECT_RUNS_INFIX}${runsPhrase}${EFFECT_RUNS_SUFFIX}`,
  ].join('');
}

/** The accessible name of the destructive step, in the effects it actually has. */
function buildConfirmUndoLabel(landing: UndoableLanding): string {
  const threadsPhrase = buildThreadCountPhrase(landing.resolvedThreadIds.length);
  return [
    `${CONFIRM_DELETE_PREFIX}${landing.integrationBranchName}`,
    `${EFFECT_REMOTE_INFIX}${landing.remoteName}`,
    `${CONFIRM_UNRESOLVE_INFIX}${threadsPhrase}`,
  ].join('');
}

function buildUndoneLabel(landing: UndoableLanding): string {
  const threadsPhrase = buildThreadCountPhrase(landing.resolvedThreadIds.length);
  const runsPhrase = buildRunCountPhrase(landing.runIds.length);
  return [
    `${UNDONE_PREFIX}${landing.integrationBranchName}`,
    `${UNDONE_DELETED_INFIX}${landing.remoteName}`,
    `${UNDONE_UNRESOLVED_INFIX}${threadsPhrase}${UNDONE_UNRESOLVED_SUFFIX}`,
    `${runsPhrase}${UNDONE_RUNS_SUFFIX}`,
  ].join('');
}

/**
 * The reverse of the gate, and gated the same way: deleting a pushed branch and
 * unresolving every thread a landing resolved is no less consequential than the landing
 * was, so it takes its own confirmation step rather than a single click.
 */
export function useLandingUndo({ prRef }: UseLandingUndoOptions): UseLandingUndoResult {
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);

  const { undoableLanding, isUndoableLandingLoading, undoableLandingError } =
    useQueryUndoableLanding();
  const { undoLanding, undoneLanding, isUndoLandingExecuting, undoLandingError } =
    useExecuteUndoLanding({ prRef });

  const onReviewClick = useCallback(() => setIsConfirmationOpen(true), []);
  const onKeepClick = useCallback(() => setIsConfirmationOpen(false), []);

  const onConfirmClick = useCallback(() => {
    if (!isDefined(undoableLanding)) return;
    undoLanding({
      landingId: undoableLanding.landingId,
      isConfirmedByUser: IS_UNDO_CONFIRMED_BY_USER,
    });
  }, [undoLanding, undoableLanding]);

  const errorMessage = ((): string | null => {
    const error = isDefined(undoLandingError) ? undoLandingError : undoableLandingError;
    if (!isDefined(error)) return null;
    return isIpcError(error) ? error.message : UNDO_ERROR_FALLBACK;
  })();

  const view = ((): LandingUndoView => {
    // The reported result outranks everything: a successful undo clears the undoable
    // landing, and dropping straight back to "nothing to undo" would swallow the one
    // message that says what was reversed and what stayed posted.
    if (isDefined(undoneLanding)) {
      return {
        kind: LANDING_UNDO_VIEW_KIND.UNDONE,
        undoneLabel: buildUndoneLabel(undoneLanding),
        replyLabel: undoneLanding.isReplyPosted
          ? UNDONE_REPLY_POSTED_LABEL
          : UNDONE_REPLY_ABSENT_LABEL,
      };
    }

    if (isUndoableLandingLoading) {
      return { kind: LANDING_UNDO_VIEW_KIND.LOADING, loadingLabel: LOADING_LABEL };
    }

    if (!isDefined(undoableLanding)) {
      return { kind: LANDING_UNDO_VIEW_KIND.UNAVAILABLE, unavailableLabel: UNAVAILABLE_LABEL };
    }

    if (isConfirmationOpen) {
      return {
        kind: LANDING_UNDO_VIEW_KIND.CONFIRMING,
        confirmHeading: CONFIRM_HEADING,
        replyWarningLabel: undoableLanding.isReplyPosted
          ? REPLY_POSTED_WARNING
          : REPLY_ABSENT_WARNING,
        effectLabel: buildEffectLabel(undoableLanding),
        confirmLabel: buildConfirmUndoLabel(undoableLanding),
        keepLabel: KEEP_LABEL,
        isUndoExecuting: isUndoLandingExecuting,
        onConfirmClick,
        onKeepClick,
      };
    }

    return {
      kind: LANDING_UNDO_VIEW_KIND.OFFERED,
      landedLabel: buildLandedLabel(undoableLanding),
      effectLabel: buildEffectLabel(undoableLanding),
      reviewLabel: REVIEW_LABEL,
      onReviewClick,
    };
  })();

  return { heading: UNDO_HEADING, view, auditNoticeLabel: AUDIT_NOTICE_LABEL, errorMessage };
}
