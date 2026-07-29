import { useCallback, useMemo, useState } from 'react';
import { APP_ERROR_KIND } from '@shared/errors';
import type { RunRevision } from '@shared/runs';
import { formatDateTime, formatRelativeTime, readNowMs, toElapsedMs } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useRun } from '@renderer/stores/runStore';
import { useExecuteRevertRun, useQueryRunRevisions } from '@renderer/modules/runs/useQueryRuns';

export interface UseRevisionHistoryOptions {
  runId: string;
}

export interface RevisionHistoryItem {
  revision: string;
  /** Enough of the hash to identify the commit without the row being all hash. */
  shortRevision: string;
  /**
   * Terse by design: these commits are squashed away at landing, so the subject is a
   * label for a step rather than prose, and nothing here tries to dress it up.
   */
  subject: string;
  committedLabel: string;
  /** The absolute time, for a tooltip that does not shift while it is read. */
  committedTitle: string;
  isCurrent: boolean;
  isBase: boolean;
  /** Non-null on the base entry only, which is the floor of the trail, not a revision. */
  note: string | null;
  /**
   * The button's visible text, so the accessible name says which revision it rewinds
   * to and how much it throws away without a second string to keep in sync.
   */
  revertLabel: string;
  isRevertDisabled: boolean;
  onRevertClick: () => void;
}

interface UseRevisionHistoryResult {
  heading: string;
  explanation: string;
  items: RevisionHistoryItem[];
  /** Non-null while there is nothing to list, which is not an error. */
  statusLabel: string | null;
  revisionsErrorMessage: string | null;
  isRevertRunPending: boolean;
  /** True once main has refused the reset because the worktree holds hand-edits. */
  isDiscardConfirmationOpen: boolean;
  discardWarningMessage: string;
  revertErrorMessage: string | null;
  onConfirmDiscardClick: () => void;
  onKeepEditsClick: () => void;
}

const HEADING = 'Revision trail';
const EXPLANATION =
  'Every change after the agent’s first result is its own commit in this comment’s worktree. They are squashed into a single commit when the patch lands, so this list is here to undo a step — not to be read as history.';

const BASE_NOTE =
  'The pull request head this worktree was created from. Reverting here throws away everything the agent did for this comment.';

const REVERT_PREFIX = 'Revert to ';
const BASE_TARGET_LABEL = 'the pull request head';
/** Nothing is committed after the newest entry, so only working-tree edits are at risk. */
const REVERT_UNCOMMITTED_SUFFIX = ', discarding any uncommitted edits';
const REVERT_SINGLE_LATER_SUFFIX = ', discarding 1 later revision';
const REVERT_LATER_PREFIX = ', discarding ';
const REVERT_LATER_SUFFIX = ' later revisions';

const DISCARD_WARNING_PREFIX = 'Reverting to ';
const DISCARD_WARNING_SUFFIX =
  ' resets this worktree hard. Every uncommitted change in it — including anything you edited by hand in the diff — is discarded along with every revision after that point, and none of it can be recovered.';
const DISCARD_WARNING_FALLBACK =
  'This worktree holds uncommitted changes, and reverting discards them along with every revision after the one you picked. None of it can be recovered.';

const LOADING_LABEL = 'Reading the worktree’s commit trail…';
const EMPTY_LABEL = 'This worktree has no commit trail yet, so there is nothing to revert to.';

const REVISIONS_ERROR_FALLBACK = 'Could not read this run’s revision trail.';
const REVERT_ERROR_FALLBACK = 'Could not revert this run.';

/**
 * Only a second, explicit press sends this. A first attempt goes out without it, and
 * main's refusal is what proves there was anything to lose.
 */
const IS_DISCARD_CONFIRMED = true;
const IS_NOT_DISCARD_CONFIRMED = false;

const NEWEST_INDEX = 0;
const NO_LATER_REVISIONS = 0;
const SINGLE_LATER_REVISION = 1;
const REVISION_START_INDEX = 0;
const SHORT_REVISION_LENGTH = 7;
const EMPTY_COUNT = 0;
const NO_REVISIONS = 0;

/** A stable identity, so an unfetched trail does not rebuild the list every render. */
const EMPTY_REVISIONS: readonly RunRevision[] = [];

function toShortRevision(revision: string): string {
  return revision.slice(REVISION_START_INDEX, SHORT_REVISION_LENGTH);
}

/** How an entry is named in prose: the base is described, everything else is a hash. */
function toTargetLabel(revision: RunRevision): string {
  if (revision.isBase) return BASE_TARGET_LABEL;
  return toShortRevision(revision.revision);
}

/**
 * The count of later revisions is on the control itself, because "revert" alone does
 * not say that everything after this point goes with it.
 */
function toRevertLabel(revision: RunRevision, laterCount: number): string {
  const target = toTargetLabel(revision);
  if (laterCount === NO_LATER_REVISIONS) {
    return `${REVERT_PREFIX}${target}${REVERT_UNCOMMITTED_SUFFIX}`;
  }
  if (laterCount === SINGLE_LATER_REVISION) {
    return `${REVERT_PREFIX}${target}${REVERT_SINGLE_LATER_SUFFIX}`;
  }
  return `${REVERT_PREFIX}${target}${REVERT_LATER_PREFIX}${laterCount}${REVERT_LATER_SUFFIX}`;
}

/**
 * Navigating and undoing, not reading. The trail is newest-first and ends at the base
 * commit, and every entry is revertible — reverting to the base is how a run's agent
 * work is thrown away entirely.
 */
export function useRevisionHistory({ runId }: UseRevisionHistoryOptions): UseRevisionHistoryResult {
  const [pendingRevision, setPendingRevision] = useState<string | null>(null);

  // The pane is deliberately never remounted between runs — a keyed remount made
  // React delete these subtrees one sibling at a time, and a cleanup that throws
  // mid-deletion strands the rest in the DOM, which is how the decision row came to
  // appear once per comment visited. Per-run state resets here instead.
  const [previousRunId, setPreviousRunId] = useState(runId);
  if (previousRunId !== runId) {
    setPreviousRunId(runId);
    setPendingRevision(null);
  }

  // The clock the relative labels are measured against is state, not a read during
  // render: `Date.now()` in render makes every re-render produce a different label.
  // It is re-read exactly when a revert is triggered, which is when the trail changes.
  const [nowMs, setNowMs] = useState(readNowMs);

  const run = useRun(runId);
  // Dismissing a run drops it from the store while its pane is still mounted, so a
  // missing record reads as an unrevised run rather than as a crash.
  const revisionCount = isDefined(run) ? run.revisionCount : NO_REVISIONS;
  const { runRevisions, isRunRevisionsLoading, runRevisionsError } = useQueryRunRevisions(
    runId,
    revisionCount,
  );
  const { revertRun, isRevertRunPending, revertRunError } = useExecuteRevertRun();

  const revisions = runRevisions ?? EMPTY_REVISIONS;

  const isWorktreeDirty =
    isIpcError(revertRunError) && revertRunError.kind === APP_ERROR_KIND.WORKTREE_DIRTY;
  const isDiscardConfirmationOpen = isWorktreeDirty && isDefined(pendingRevision);

  const startRevert = useCallback(
    (revision: string) => {
      setNowMs(readNowMs());
      // Remembered so the confirmed retry rewinds to the revision that was actually
      // asked for rather than re-deriving it from which row is on screen.
      setPendingRevision(revision);
      revertRun({ runId, revision, isDiscardConfirmed: IS_NOT_DISCARD_CONFIRMED });
    },
    [revertRun, runId],
  );

  const items = useMemo(
    () =>
      revisions.map((revision, index) => {
        const elapsedMs = toElapsedMs(revision.committedAt, nowMs);
        return {
          revision: revision.revision,
          shortRevision: toShortRevision(revision.revision),
          subject: revision.subject,
          committedLabel: formatRelativeTime(elapsedMs),
          committedTitle: formatDateTime(revision.committedAt),
          // The trail arrives newest-first, so the head is the first entry and the
          // index of any entry is the number of revisions stacked on top of it.
          isCurrent: index === NEWEST_INDEX,
          isBase: revision.isBase,
          note: revision.isBase ? BASE_NOTE : null,
          revertLabel: toRevertLabel(revision, index),
          isRevertDisabled: isRevertRunPending || isDiscardConfirmationOpen,
          onRevertClick: () => startRevert(revision.revision),
        };
      }),
    [isDiscardConfirmationOpen, isRevertRunPending, nowMs, revisions, startRevert],
  );

  const onConfirmDiscardClick = useCallback(() => {
    if (!isDefined(pendingRevision)) return;
    revertRun({ runId, revision: pendingRevision, isDiscardConfirmed: IS_DISCARD_CONFIRMED });
  }, [pendingRevision, revertRun, runId]);

  const onKeepEditsClick = useCallback(() => setPendingRevision(null), []);

  const statusLabel = (() => {
    if (isRunRevisionsLoading) return LOADING_LABEL;
    if (items.length === EMPTY_COUNT) return EMPTY_LABEL;
    return null;
  })();

  const revisionsErrorMessage = (() => {
    if (!isDefined(runRevisionsError)) return null;
    return isIpcError(runRevisionsError) ? runRevisionsError.message : REVISIONS_ERROR_FALLBACK;
  })();

  const revertErrorMessage = (() => {
    if (!isDefined(revertRunError)) return null;
    // The dirty-worktree refusal is a question, not a failure, so it is rendered as
    // the confirmation below rather than twice as an error too.
    if (isWorktreeDirty) return null;
    return isIpcError(revertRunError) ? revertRunError.message : REVERT_ERROR_FALLBACK;
  })();

  const pendingRevisionEntry = revisions.find((entry) => entry.revision === pendingRevision);
  const discardWarningMessage = isDefined(pendingRevisionEntry)
    ? `${DISCARD_WARNING_PREFIX}${toTargetLabel(pendingRevisionEntry)}${DISCARD_WARNING_SUFFIX}`
    : DISCARD_WARNING_FALLBACK;

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    items,
    statusLabel,
    revisionsErrorMessage,
    isRevertRunPending,
    isDiscardConfirmationOpen,
    discardWarningMessage,
    revertErrorMessage,
    onConfirmDiscardClick,
    onKeepEditsClick,
  };
}
