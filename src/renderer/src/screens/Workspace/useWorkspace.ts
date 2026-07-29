import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
  type RefCallback,
} from 'react';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { RUN_STATE, type RunState } from '@shared/runState';
import { useReviewShortcuts } from '@renderer/hooks/useReviewShortcuts';
import { useQueryPrComments } from '@renderer/modules/comments/useQueryPrComments';
import type { CommentTreeNavigationHandle } from '@renderer/modules/comments/CommentTree/useCommentTreeNavigation';
import { useQueryPrStatus } from '@renderer/modules/discovery/useQueryPrStatus';
import { useExecuteDismissRun, useQueryRuns } from '@renderer/modules/runs/useQueryRuns';
import { useReviewDecision } from '@renderer/modules/review/ReviewDecision/useReviewDecision';
import { prRefKey } from '@shared/discovery';
import {
  selectRunForComment,
  useRunForComment,
  useRunStateByCommentId,
  useRunStore,
  type RunsById,
} from '@renderer/stores/runStore';
import { useSessionStore } from '@renderer/stores/sessionStore';
import { useElementSize } from '@renderer/hooks/useElementSize';
import { clamp } from '@renderer/lib/numbers';
import { LEFT_PANE_WIDTH, REVIEW_PANE_MIN_WIDTH, type PaneVisibility } from '@shared/settings';

/** Nothing is reserved for a pane that is not on screen. */
const NO_RESERVED_SIZE = 0;
/** The width reported before the layout element has been observed even once. */
const UNMEASURED_LAYOUT_SIZE = 0;

/**
 * Only reached before the PR's own base branch is known — not every repository
 * merges into `main`, so this is a placeholder for the gap between selecting a PR
 * and its status arriving, never a claim about where the landing should go.
 */
const FALLBACK_TARGET_BRANCH = 'main';

export type PaneKey = keyof PaneVisibility;

export interface PaneToggleItem {
  key: PaneKey;
  label: string;
  isVisible: boolean;
  isDisabled: boolean;
  onToggle: () => void;
}

/** Declared once so the toggles, the count and the layout agree on the order. */
const PANE_KEYS: readonly PaneKey[] = ['commentList', 'reviewPane'];

const PANE_LABEL: Record<PaneKey, string> = {
  commentList: 'Comments',
  reviewPane: 'Review',
};

const LAST_VISIBLE_PANE_COUNT = 1;

interface PaneSizeRange {
  MIN: number;
  MAX: number;
}

/**
 * What a pane may grow to: whatever the window leaves, within its own declared range.
 * Before the first measurement there is no window size to go on, so the declared
 * maximum stands — a computed one would be the minimum, and every mount would snap the
 * panes narrow for a frame before widening them again.
 */
function resolveMaxSize(range: PaneSizeRange, availableSize: number, isMeasured: boolean): number {
  if (!isMeasured) return range.MAX;
  return clamp(availableSize, range.MIN, range.MAX);
}

/** A stable identity, so a filling pane does not restyle its element every render. */
const EMPTY_STYLE: CSSProperties = {};

/** A stable identity, so an absent result does not remount the tree every render. */
const EMPTY_COMMENTS: PrComment[] = [];

/** The states that mean a comment is waiting on the reviewer, not on an agent. */
const AWAITING_REVIEW_STATES: readonly RunState[] = [RUN_STATE.READY, RUN_STATE.NEEDS_DECISION];

function isAwaitingReview(runsById: RunsById, commentId: string): boolean {
  const run = selectRunForComment(runsById, commentId);
  return run !== null && AWAITING_REVIEW_STATES.includes(run.state);
}

/**
 * The next comment after the current one — wrapping — whose run is waiting on the
 * reviewer. Comment order rather than run order, so advancing walks the tree the way
 * the eye does.
 */
function findNextAwaitingCommentId(
  comments: readonly PrComment[],
  runsById: RunsById,
  currentCommentId: string,
): string | null {
  const currentIndex = comments.findIndex((comment) => comment.id === currentCommentId);
  if (currentIndex === -1) return null;

  for (let offset = 1; offset < comments.length; offset += 1) {
    const candidate = comments[(currentIndex + offset) % comments.length];
    if (isAwaitingReview(runsById, candidate.id)) return candidate.id;
  }
  return null;
}

interface UseWorkspaceResult {
  selectedPr: PrRef | null;
  isPickerOpen: boolean;
  comments: PrComment[];
  selectedComment: PrComment | null;
  selectedCommentId: string | null;
  isPrCommentsLoading: boolean;
  isPrCommentsFetching: boolean;
  prCommentsError: unknown;
  /** Drives the tree's run-state badges and its attention-budget expansion. */
  runStateByCommentId: Readonly<Record<string, RunState>>;
  commentTreeRef: Ref<CommentTreeNavigationHandle>;
  diffPaneRef: Ref<HTMLDivElement>;
  /** A persisted pixel size cannot be a utility class, so it arrives as a style. */
  leftPaneStyle: CSSProperties;
  layoutRef: RefCallback<HTMLDivElement>;
  leftPaneWidth: number;
  /**
   * Bounded by the window rather than by a constant, so widening the list can never
   * leave the review pane too narrow to render a patch in.
   */
  leftPaneMaxWidth: number;
  onLeftPaneWidthChange: (width: number) => void;
  paneToggleItems: PaneToggleItem[];
  isCommentListVisible: boolean;
  isReviewPaneVisible: boolean;
  /**
   * True while the list has nothing beside it to take the leftover space, which is when
   * its persisted width would leave the rest of the window blank.
   */
  isCommentListFilling: boolean;
  targetBranch: string;
  isLandingOpen: boolean;
  onTargetBranchChange: (targetBranch: string) => void;
  onOpenLanding: () => void;
  /**
   * One level up, whatever the level: landing → comments → the pull request list.
   * Two back affordances was one too many, and one of them led nowhere.
   */
  onBackClick: () => void;
  isBackAvailable: boolean;
  isShortcutHelpOpen: boolean;
  onShowShortcutHelp: () => void;
  onCloseShortcutHelp: () => void;
  onSelectPr: (ref: PrRef) => void;
  onSelectComment: (commentId: string) => void;
  onRefreshComments: () => void;
}

/**
 * The Workspace owns orchestration: it lifts the selected comment so the tree and
 * the detail pane stay decoupled, and it fetches the comment set once so both panes
 * read the same data.
 */
export function useWorkspace(): UseWorkspaceResult {
  const selectedPr = useSessionStore((state) => state.lastPr);
  const setLastPr = useSessionStore((state) => state.setLastPr);
  const markPrViewed = useSessionStore((state) => state.markPrViewed);

  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isLandingOpen, setIsLandingOpen] = useState(false);
  const targetBranchByPr = useSessionStore((state) => state.targetBranchByPr);
  const setTargetBranch = useSessionStore((state) => state.setTargetBranch);
  const paneSizes = useSessionStore((state) => state.paneSizes);
  const setPaneSizes = useSessionStore((state) => state.setPaneSizes);
  const paneVisibility = useSessionStore((state) => state.paneVisibility);
  const clearCommentSelection = useSessionStore((state) => state.clearCommentSelection);
  const setPaneVisibility = useSessionStore((state) => state.setPaneVisibility);

  const {
    prComments,
    isPrCommentsLoading,
    isPrCommentsFetching,
    prCommentsError,
    refetchPrComments,
  } = useQueryPrComments(selectedPr);

  // Hydrates the run store from persisted state, so a restart does not show an
  // empty queue for runs that are still alive in main.
  useQueryRuns(selectedPr);
  const runStateByCommentId = useRunStateByCommentId();
  const { prStatus } = useQueryPrStatus(selectedPr);

  // An edit you made for this PR wins; otherwise the PR's own branch — a local
  // landing puts the commits where the PR is from, so pushing that branch is what
  // updates the PR.
  const targetBranch =
    selectedPr === null
      ? FALLBACK_TARGET_BRANCH
      : (targetBranchByPr[prRefKey(selectedPr)] ?? prStatus?.headRefName ?? FALLBACK_TARGET_BRANCH);

  const commentTreeRef = useRef<CommentTreeNavigationHandle>(null);
  const diffPaneRef = useRef<HTMLDivElement>(null);
  const selectedRun = useRunForComment(selectedCommentId);
  const { dismissRun } = useExecuteDismissRun();

  const comments = prComments ?? EMPTY_COMMENTS;
  const selectedComment = comments.find((comment) => comment.id === selectedCommentId) ?? null;

  const isSelectedRunDismissable =
    selectedRun !== null &&
    (selectedRun.state === RUN_STATE.NO_ACTION_NEEDED ||
      selectedRun.state === RUN_STATE.FAILED ||
      selectedRun.state === RUN_STATE.REJECTED);

  // The same hook the review pane uses, so the shortcut and the button can never
  // disagree about whether an action is on offer — both read one source. A null
  // handler means "not offered", which keeps the shortcut from swallowing the key.
  const { onApproveClick, onRejectClick } = useReviewDecision({
    runId: selectedRun?.id ?? null,
  });

  // The review pane is the one that flexes, so the list only carries a fixed width while
  // the review pane is there to absorb what is left over.
  const isCommentListFilling = !paneVisibility.reviewPane;

  const visiblePaneCount = PANE_KEYS.filter((key) => paneVisibility[key]).length;
  const isLastVisiblePane = visiblePaneCount === LAST_VISIBLE_PANE_COUNT;

  const paneToggleItems: PaneToggleItem[] = PANE_KEYS.map((key) => ({
    key,
    label: PANE_LABEL[key],
    isVisible: paneVisibility[key],
    // An empty workspace is not a focus mode, so the last one on cannot be turned off.
    isDisabled: paneVisibility[key] && isLastVisiblePane,
    onToggle: () => setPaneVisibility({ [key]: !paneVisibility[key] }),
  }));

  const { ref: layoutRef, width: layoutWidth } = useElementSize<HTMLDivElement>();

  const isLayoutMeasured = layoutWidth > UNMEASURED_LAYOUT_SIZE;

  const leftPaneMaxWidth = resolveMaxSize(
    LEFT_PANE_WIDTH,
    layoutWidth - (paneVisibility.reviewPane ? REVIEW_PANE_MIN_WIDTH : NO_RESERVED_SIZE),
    isLayoutMeasured,
  );

  // A size saved on a wider window would otherwise push its neighbour off screen, so
  // what is rendered is the saved value seen through the current window's limits. The
  // stored value is left alone: making the window narrow for a minute should not lose
  // the layout you had.
  const leftPaneWidth = clamp(paneSizes.left, LEFT_PANE_WIDTH.MIN, leftPaneMaxWidth);

  const leftPaneStyle = useMemo(
    () => (isCommentListFilling ? EMPTY_STYLE : { width: leftPaneWidth }),
    [isCommentListFilling, leftPaneWidth],
  );

  const onLeftPaneWidthChange = useCallback(
    (left: number) => setPaneSizes({ left }),
    [setPaneSizes],
  );

  const onDismissSelectedRun = useCallback(() => {
    if (selectedRun === null) return;
    dismissRun(selectedRun.id);
  }, [selectedRun, dismissRun]);

  /**
   * The hunk and inline-prompt keys are deliberately not connected here. They are
   * registered on the Monaco editors themselves, which is where the selection and the
   * side it came from actually live; the hook ignores a binding it has no handler for,
   * so those keys reach the editor untouched rather than being swallowed at the window.
   */
  const { isShortcutHelpOpen, onShowShortcutHelp, onCloseShortcutHelp } = useReviewShortcuts({
    onFocusNextRow: useCallback(() => commentTreeRef.current?.focusNextRow(), []),
    onFocusPreviousRow: useCallback(() => commentTreeRef.current?.focusPreviousRow(), []),
    onCollapseFocusedRow: useCallback(() => commentTreeRef.current?.collapseFocusedRow(), []),
    onExpandFocusedRow: useCallback(() => commentTreeRef.current?.expandFocusedRow(), []),
    onFocusDiffPane: useCallback(() => diffPaneRef.current?.focus(), []),
    onDismissRun: isSelectedRunDismissable ? onDismissSelectedRun : undefined,
    onApproveRun: onApproveClick ?? undefined,
    onRejectRun: onRejectClick ?? undefined,
  });

  // Deciding advances the selection to the next comment awaiting review, so working
  // through the punch list is decide, read, decide rather than a walk back to the tree
  // after every decision. A store subscription rather than an effect on derived state:
  // the transition is the event, and this fires exactly once per transition whether the
  // decision came from the button, the keyboard, or a bulk approve.
  const advanceContextRef = useRef({ selectedCommentId, comments });
  useEffect(() => {
    advanceContextRef.current = { selectedCommentId, comments };
  }, [selectedCommentId, comments]);

  useEffect(() => {
    return useRunStore.subscribe((state, previousState) => {
      // A landed comment is a closed punch-list item, so it leaves the selection: a
      // ticked checkbox that survives landing keeps offering to start the work again.
      const landedCommentIds = Object.values(state.runsById)
        .filter((run) => run.state === RUN_STATE.APPLIED)
        .filter(
          (run) =>
            selectRunForComment(previousState.runsById, run.commentId)?.state !== RUN_STATE.APPLIED,
        )
        .map((run) => run.commentId);
      if (landedCommentIds.length > 0) clearCommentSelection(landedCommentIds);

      const { selectedCommentId: commentId, comments: currentComments } = advanceContextRef.current;
      if (commentId === null) return;

      const previousRun = selectRunForComment(previousState.runsById, commentId);
      const currentRun = selectRunForComment(state.runsById, commentId);
      if (previousRun === null || currentRun === null) return;

      const wasAwaiting = AWAITING_REVIEW_STATES.includes(previousRun.state);
      const isDecided =
        currentRun.state === RUN_STATE.APPROVED || currentRun.state === RUN_STATE.REJECTED;
      if (!wasAwaiting || !isDecided) return;

      const nextCommentId = findNextAwaitingCommentId(currentComments, state.runsById, commentId);
      if (nextCommentId !== null) setSelectedCommentId(nextCommentId);
    });
  }, [clearCommentSelection]);

  // Stamped once the comments actually arrive, so the new-since-last-viewed marker
  // reflects what you could have seen rather than merely which PR was open.
  useEffect(() => {
    if (selectedPr === null || prComments === undefined) return;
    markPrViewed(selectedPr);
  }, [selectedPr, prComments, markPrViewed]);

  return {
    selectedPr,
    isPickerOpen,
    comments,
    selectedComment,
    selectedCommentId,
    isPrCommentsLoading,
    isPrCommentsFetching,
    prCommentsError,
    runStateByCommentId,
    commentTreeRef,
    diffPaneRef,
    leftPaneStyle,
    layoutRef,
    leftPaneWidth,
    leftPaneMaxWidth,
    onLeftPaneWidthChange,
    paneToggleItems,
    isCommentListVisible: paneVisibility.commentList,
    isReviewPaneVisible: paneVisibility.reviewPane,
    isCommentListFilling,
    isShortcutHelpOpen,
    onShowShortcutHelp,
    onCloseShortcutHelp,
    onSelectPr: (ref) => {
      setLastPr(ref);
      setSelectedCommentId(null);
      setIsPickerOpen(false);
      setIsLandingOpen(false);
    },
    onSelectComment: setSelectedCommentId,
    targetBranch,
    isLandingOpen,
    onTargetBranchChange: (nextTargetBranch: string) => {
      if (selectedPr === null) return;
      setTargetBranch(selectedPr, nextTargetBranch);
    },
    // Opening the gate is a view change, not an action: the preview assembles in the
    // sandbox and nothing it shows has happened yet.
    onOpenLanding: () => setIsLandingOpen(true),
    onBackClick: () => {
      if (isLandingOpen) {
        setIsLandingOpen(false);
        return;
      }
      if (isPickerOpen) {
        setIsPickerOpen(false);
        return;
      }
      setIsPickerOpen(true);
    },
    // Home is the list: with no PR selected there is nowhere further up to go.
    isBackAvailable: selectedPr !== null,
    onRefreshComments: refetchPrComments,
  };
}
