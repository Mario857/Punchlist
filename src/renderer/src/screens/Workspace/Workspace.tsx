import { ShortcutHelp } from '@renderer/components/ShortcutHelp/ShortcutHelp';
import { Spinner } from '@renderer/components/Spinner';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { CommentTree } from '@renderer/modules/comments/CommentTree/CommentTree';
import { FilterBar } from '@renderer/modules/comments/FilterBar/FilterBar';
import { LandingPreview } from '@renderer/modules/landing/LandingPreview/LandingPreview';
import { PrPicker } from '@renderer/modules/discovery/PrPicker/PrPicker';
import { CommentDetail } from '@renderer/modules/review/CommentDetail/CommentDetail';
import { RunPane } from '@renderer/modules/review/RunPane/RunPane';
import { RunControls } from '@renderer/modules/runs/RunControls/RunControls';
import { BOTTOM_PANE_HEIGHT, LEFT_PANE_WIDTH, RIGHT_PANE_WIDTH } from '@shared/settings';
import { PaneDivider } from './components/PaneDivider/PaneDivider';
import { PANE_AXIS, PANE_EDGE } from './components/PaneDivider/usePaneDivider';
import { WorkspaceTopBar } from './components/WorkspaceTopBar';
import { useWorkspace } from './useWorkspace';

// The dividers carry the border now, so the panes no longer draw their own.
const COLUMNS_CLASS = 'flex min-h-0 min-w-0 flex-1';
const LEFT_PANE_CLASS = 'flex shrink-0 flex-col overflow-hidden';
const CENTER_PANE_CLASS = 'min-w-0 flex-1 overflow-y-auto';
const RUN_PANE_CLASS = 'shrink-0 overflow-y-auto';
/** A pane with nothing beside it takes the space instead of its persisted size. */
const FILLING_PANE_CLASS = 'min-w-0 flex-1 overflow-y-auto';
const FILLING_LIST_CLASS = 'flex min-w-0 flex-1 flex-col overflow-hidden';
const LEFT_DIVIDER_LABEL = 'Resize the comment list';
const RIGHT_DIVIDER_LABEL = 'Resize the run pane';
const BOTTOM_DIVIDER_LABEL = 'Resize the run pane';
/** Focusable by the `e` shortcut, but never a stop in the normal tab order. */
const PANE_FOCUS_TAB_INDEX = -1;
const COMMENTS_ERROR_FALLBACK = 'Could not load comments for this pull request.';

export function Workspace() {
  const {
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
    leftPaneWidth,
    rightPaneWidth,
    bottomPaneHeight,
    onLeftPaneWidthChange,
    onRightPaneWidthChange,
    onBottomPaneHeightChange,
    isRunPaneOnBottom,
    runPanePlacementLabel,
    onToggleRunPanePlacement,
    paneToggleItems,
    isCommentListVisible,
    isCommentDetailVisible,
    isRunPaneVisible,
    isCommentListFilling,
    isRunPaneFilling,
    targetBranch,
    isLandingOpen,
    onTargetBranchChange,
    onToggleLanding,
    isShortcutHelpOpen,
    onShowShortcutHelp,
    onCloseShortcutHelp,
    onSelectPr,
    onSelectComment,
    onTogglePicker,
    onRefreshComments,
  } = useWorkspace();

  const commentsErrorMessage = isIpcError(prCommentsError)
    ? prCommentsError.message
    : COMMENTS_ERROR_FALLBACK;
  const commentsErrorRemediation = isIpcError(prCommentsError) ? prCommentsError.remediation : null;

  const leftPane = (() => {
    if (isPrCommentsLoading) {
      return (
        <div className="grid flex-1 place-items-center">
          <Spinner label="Loading comments" />
        </div>
      );
    }
    if (isDefined(prCommentsError)) {
      return (
        <div role="alert" className="flex-1 p-4">
          <p className="text-danger text-sm">{commentsErrorMessage}</p>
          <p className="text-muted mt-2 text-xs">{commentsErrorRemediation}</p>
        </div>
      );
    }
    if (selectedPr === null) return null;
    return (
      <>
        <FilterBar comments={comments} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CommentTree
            prRef={selectedPr}
            comments={comments}
            selectedCommentId={selectedCommentId}
            onSelectComment={onSelectComment}
            runStateByCommentId={runStateByCommentId}
            ref={commentTreeRef}
          />
        </div>
      </>
    );
  })();

  const body = (() => {
    // The gate takes the whole area: deciding to land is not something to do out of
    // the corner of an eye while the tree is still competing for attention.
    if (selectedPr !== null && isLandingOpen) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <LandingPreview prRef={selectedPr} targetBranch={targetBranch} />
        </div>
      );
    }

    // The picker takes the whole area when no PR is chosen: there is nothing to lay
    // three panes out around yet.
    if (selectedPr === null || isPickerOpen) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <PrPicker selectedPr={selectedPr} onSelectPr={onSelectPr} />
        </div>
      );
    }
    // Extracted so both placements render the same pane rather than two that can drift.
    const runPane = !isRunPaneVisible ? null : (
      /* tabIndex makes the pane a focus target for the `e` shortcut, without making it
         a tab stop in the normal order. */
      <div
        className={isRunPaneFilling ? FILLING_PANE_CLASS : RUN_PANE_CLASS}
        style={runPaneStyle}
        ref={diffPaneRef}
        tabIndex={PANE_FOCUS_TAB_INDEX}
      >
        <RunPane commentId={selectedCommentId} />
      </div>
    );

    const commentList = !isCommentListVisible ? null : (
      <div
        className={isCommentListFilling ? FILLING_LIST_CLASS : LEFT_PANE_CLASS}
        style={leftPaneStyle}
      >
        {leftPane}
      </div>
    );

    // A divider only exists between two panes, so hiding either takes it with them.
    const listDivider =
      isCommentListVisible && isCommentDetailVisible ? (
        <PaneDivider
          label={LEFT_DIVIDER_LABEL}
          axis={PANE_AXIS.HORIZONTAL}
          edge={PANE_EDGE.LEADING}
          size={leftPaneWidth}
          minSize={LEFT_PANE_WIDTH.MIN}
          maxSize={LEFT_PANE_WIDTH.MAX}
          onSizeChange={onLeftPaneWidthChange}
        />
      ) : null;

    const commentDetail = !isCommentDetailVisible ? null : (
      <div className={CENTER_PANE_CLASS}>
        <CommentDetail comment={selectedComment} />
      </div>
    );

    const hasCommentColumns = isCommentListVisible || isCommentDetailVisible;
    const commentColumns = !hasCommentColumns ? null : (
      <div className={COLUMNS_CLASS}>
        {commentList}
        {listDivider}
        {commentDetail}
      </div>
    );

    // The run divider needs a pane on each side of it too.
    const hasRunDivider = hasCommentColumns && isRunPaneVisible;

    // Along the bottom the run pane spans the full window, which is the shape a patch
    // actually wants: a diff is wide before it is tall.
    if (isRunPaneOnBottom) {
      const bottomDivider = !hasRunDivider ? null : (
        <PaneDivider
          label={BOTTOM_DIVIDER_LABEL}
          axis={PANE_AXIS.VERTICAL}
          edge={PANE_EDGE.TRAILING}
          size={bottomPaneHeight}
          minSize={BOTTOM_PANE_HEIGHT.MIN}
          maxSize={BOTTOM_PANE_HEIGHT.MAX}
          onSizeChange={onBottomPaneHeightChange}
        />
      );

      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {commentColumns}
          {bottomDivider}
          {runPane}
        </div>
      );
    }

    const rightDivider = !hasRunDivider ? null : (
      <PaneDivider
        label={RIGHT_DIVIDER_LABEL}
        axis={PANE_AXIS.HORIZONTAL}
        edge={PANE_EDGE.TRAILING}
        size={rightPaneWidth}
        minSize={RIGHT_PANE_WIDTH.MIN}
        maxSize={RIGHT_PANE_WIDTH.MAX}
        onSizeChange={onRightPaneWidthChange}
      />
    );

    return (
      <div className={COLUMNS_CLASS}>
        {commentColumns}
        {rightDivider}
        {runPane}
      </div>
    );
  })();

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <WorkspaceTopBar
        selectedPr={selectedPr}
        isPickerOpen={isPickerOpen}
        isRefreshing={isPrCommentsFetching}
        onTogglePicker={onTogglePicker}
        onRefreshComments={onRefreshComments}
        onShowShortcutHelp={onShowShortcutHelp}
        targetBranch={targetBranch}
        runPanePlacementLabel={runPanePlacementLabel}
        onToggleRunPanePlacement={onToggleRunPanePlacement}
        paneToggleItems={paneToggleItems}
        isLandingOpen={isLandingOpen}
        onTargetBranchChange={onTargetBranchChange}
        onToggleLanding={onToggleLanding}
      />
      <RunControls prRef={selectedPr} />
      {body}
      <ShortcutHelp isOpen={isShortcutHelpOpen} onClose={onCloseShortcutHelp} />
    </main>
  );
}
