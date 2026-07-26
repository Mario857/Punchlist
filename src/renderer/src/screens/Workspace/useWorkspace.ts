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
import { useRunForComment, useRunStateByCommentId } from '@renderer/stores/runStore';
import { useSessionStore } from '@renderer/stores/sessionStore';
import { useElementSize } from '@renderer/hooks/useElementSize';
import { clamp } from '@renderer/lib/numbers';
import {
  BOTTOM_PANE_HEIGHT,
  CENTER_PANE_MIN_WIDTH,
  COLUMNS_MIN_HEIGHT,
  LEFT_PANE_WIDTH,
  RIGHT_PANE_WIDTH,
  RUN_PANE_PLACEMENT,
  type PaneVisibility,
} from '@shared/settings';

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
const PANE_KEYS: readonly PaneKey[] = ['commentList', 'commentDetail', 'runPane'];

const PANE_LABEL: Record<PaneKey, string> = {
  commentList: 'Comments',
  commentDetail: 'Detail',
  runPane: 'Run',
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

/** Says where the pane would go, not where it is — it is an action, not a status. */
const MOVE_TO_BOTTOM_LABEL = 'Run pane to bottom';
const MOVE_TO_SIDE_LABEL = 'Run pane to side';

/** A stable identity, so an absent result does not remount the tree every render. */
const EMPTY_COMMENTS: PrComment[] = [];

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
  /** Width or height depending on placement, decided here so markup does not branch. */
  runPaneStyle: CSSProperties;
  layoutRef: RefCallback<HTMLDivElement>;
  leftPaneWidth: number;
  rightPaneWidth: number;
  bottomPaneHeight: number;
  /**
   * Bounded by the window rather than by a constant, so maximising one pane can never
   * make its neighbour unshrinkable.
   */
  leftPaneMaxWidth: number;
  rightPaneMaxWidth: number;
  bottomPaneMaxHeight: number;
  onLeftPaneWidthChange: (width: number) => void;
  onRightPaneWidthChange: (width: number) => void;
  onBottomPaneHeightChange: (height: number) => void;
  isRunPaneOnBottom: boolean;
  runPanePlacementLabel: string;
  onToggleRunPanePlacement: () => void;
  paneToggleItems: PaneToggleItem[];
  isCommentListVisible: boolean;
  isCommentDetailVisible: boolean;
  isRunPaneVisible: boolean;
  /**
   * True while a pane has nothing beside it to take the leftover space, which is when
   * a persisted pixel size would leave the rest of the window blank.
   */
  isCommentListFilling: boolean;
  isRunPaneFilling: boolean;
  targetBranch: string;
  isLandingOpen: boolean;
  onTargetBranchChange: (targetBranch: string) => void;
  onToggleLanding: () => void;
  isShortcutHelpOpen: boolean;
  onShowShortcutHelp: () => void;
  onCloseShortcutHelp: () => void;
  onSelectPr: (ref: PrRef) => void;
  onSelectComment: (commentId: string) => void;
  onTogglePicker: () => void;
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
  const runPanePlacement = useSessionStore((state) => state.runPanePlacement);
  const setRunPanePlacement = useSessionStore((state) => state.setRunPanePlacement);
  const paneVisibility = useSessionStore((state) => state.paneVisibility);
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

  // An edit you made for this PR wins; otherwise the branch the PR is actually open
  // against, which is the only defensible default.
  const targetBranch =
    selectedPr === null
      ? FALLBACK_TARGET_BRANCH
      : (targetBranchByPr[prRefKey(selectedPr)] ?? prStatus?.baseRefName ?? FALLBACK_TARGET_BRANCH);

  const commentTreeRef = useRef<CommentTreeNavigationHandle>(null);
  const diffPaneRef = useRef<HTMLDivElement>(null);
  const selectedRun = useRunForComment(selectedCommentId);
  const { dismissRun } = useExecuteDismissRun();

  const comments = prComments ?? EMPTY_COMMENTS;
  const selectedComment = comments.find((comment) => comment.id === selectedCommentId) ?? null;

  const isSelectedRunDismissable =
    selectedRun !== null &&
    (selectedRun.state === RUN_STATE.NO_ACTION_NEEDED || selectedRun.state === RUN_STATE.FAILED);

  // The same hook the review pane uses, so the shortcut and the button can never
  // disagree about whether an action is on offer — both read one source. A null
  // handler means "not offered", which keeps the shortcut from swallowing the key.
  const { onApproveClick, onRejectClick } = useReviewDecision({
    runId: selectedRun?.id ?? null,
  });

  const isRunPaneOnBottom = runPanePlacement === RUN_PANE_PLACEMENT.BOTTOM;

  // The detail pane is the one that flexes, so with it hidden the list takes that role
  // and the run pane keeps its persisted width. Leaving both of them fixed is the bug
  // this replaced: nothing absorbed the leftover space, and the only divider left was
  // the run pane's, so the comment list could not be resized at all.
  const isCommentListFilling = !paneVisibility.commentDetail;
  const isRunPaneFilling = !paneVisibility.commentList && !paneVisibility.commentDetail;

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

  const {
    ref: layoutRef,
    width: layoutWidth,
    height: layoutHeight,
  } = useElementSize<HTMLDivElement>();

  const detailReservedWidth = paneVisibility.commentDetail
    ? CENTER_PANE_MIN_WIDTH
    : NO_RESERVED_SIZE;
  const isRunPaneBesideColumns = paneVisibility.runPane && !isRunPaneOnBottom;

  const isLayoutMeasured = layoutWidth > UNMEASURED_LAYOUT_SIZE;

  const leftPaneMaxWidth = resolveMaxSize(
    LEFT_PANE_WIDTH,
    layoutWidth -
      detailReservedWidth -
      (isRunPaneBesideColumns ? RIGHT_PANE_WIDTH.MIN : NO_RESERVED_SIZE),
    isLayoutMeasured,
  );
  const rightPaneMaxWidth = resolveMaxSize(
    RIGHT_PANE_WIDTH,
    layoutWidth -
      detailReservedWidth -
      (paneVisibility.commentList ? LEFT_PANE_WIDTH.MIN : NO_RESERVED_SIZE),
    isLayoutMeasured,
  );
  const bottomPaneMaxHeight = resolveMaxSize(
    BOTTOM_PANE_HEIGHT,
    layoutHeight - COLUMNS_MIN_HEIGHT,
    isLayoutMeasured,
  );

  // A size saved on a wider window would otherwise push its neighbour off screen, so
  // what is rendered is the saved value seen through the current window's limits. The
  // stored value is left alone: making the window narrow for a minute should not lose
  // the layout you had.
  const leftPaneWidth = clamp(paneSizes.left, LEFT_PANE_WIDTH.MIN, leftPaneMaxWidth);
  const rightPaneWidth = clamp(paneSizes.right, RIGHT_PANE_WIDTH.MIN, rightPaneMaxWidth);
  const bottomPaneHeight = clamp(paneSizes.bottom, BOTTOM_PANE_HEIGHT.MIN, bottomPaneMaxHeight);

  const leftPaneStyle = useMemo(
    () => (isCommentListFilling ? EMPTY_STYLE : { width: leftPaneWidth }),
    [isCommentListFilling, leftPaneWidth],
  );
  const runPaneStyle = useMemo(() => {
    if (isRunPaneFilling) return EMPTY_STYLE;
    return isRunPaneOnBottom ? { height: bottomPaneHeight } : { width: rightPaneWidth };
  }, [isRunPaneFilling, isRunPaneOnBottom, bottomPaneHeight, rightPaneWidth]);

  const onLeftPaneWidthChange = useCallback(
    (left: number) => setPaneSizes({ left }),
    [setPaneSizes],
  );
  const onRightPaneWidthChange = useCallback(
    (right: number) => setPaneSizes({ right }),
    [setPaneSizes],
  );
  const onBottomPaneHeightChange = useCallback(
    (bottom: number) => setPaneSizes({ bottom }),
    [setPaneSizes],
  );

  const onToggleRunPanePlacement = useCallback(() => {
    setRunPanePlacement(
      runPanePlacement === RUN_PANE_PLACEMENT.BOTTOM
        ? RUN_PANE_PLACEMENT.RIGHT
        : RUN_PANE_PLACEMENT.BOTTOM,
    );
  }, [runPanePlacement, setRunPanePlacement]);

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
    runPaneStyle,
    layoutRef,
    leftPaneWidth,
    rightPaneWidth,
    bottomPaneHeight,
    leftPaneMaxWidth,
    rightPaneMaxWidth,
    bottomPaneMaxHeight,
    onLeftPaneWidthChange,
    onRightPaneWidthChange,
    onBottomPaneHeightChange,
    isRunPaneOnBottom,
    runPanePlacementLabel: isRunPaneOnBottom ? MOVE_TO_SIDE_LABEL : MOVE_TO_BOTTOM_LABEL,
    onToggleRunPanePlacement,
    paneToggleItems,
    isCommentListVisible: paneVisibility.commentList,
    isCommentDetailVisible: paneVisibility.commentDetail,
    isRunPaneVisible: paneVisibility.runPane,
    isCommentListFilling,
    isRunPaneFilling,
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
    onToggleLanding: () => setIsLandingOpen((isOpen) => !isOpen),
    onTogglePicker: () => setIsPickerOpen((isOpen) => !isOpen),
    onRefreshComments: refetchPrComments,
  };
}
