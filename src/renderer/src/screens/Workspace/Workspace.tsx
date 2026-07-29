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
import { LEFT_PANE_WIDTH } from '@shared/settings';
import { PaneDivider } from './components/PaneDivider/PaneDivider';
import { PANE_EDGE } from './components/PaneDivider/usePaneDivider';
import { StatusBar } from './components/StatusBar/StatusBar';
import { WorkspaceTopBar } from './components/WorkspaceTopBar';
import { useWorkspace } from './useWorkspace';

// The divider carries the border now, so the panes no longer draw their own.
const COLUMNS_CLASS = 'flex min-h-0 min-w-0 flex-1';
const LEFT_PANE_CLASS = 'flex shrink-0 flex-col overflow-hidden';
/** The list takes the space instead of its persisted width when nothing is beside it. */
const FILLING_LIST_CLASS = 'flex min-w-0 flex-1 flex-col overflow-hidden';
/**
 * One scrolling column holding the comment and the work done on it. They were two panes
 * and are one because they are one thing: the comment states what has to change and the
 * patch is the answer, so reading the answer without the question in view was the whole
 * difficulty. The comment leads, the resolution follows.
 */
const REVIEW_PANE_CLASS = 'flex min-w-0 flex-1 flex-col overflow-y-auto';
const LEFT_DIVIDER_LABEL = 'Resize the comment list';
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
    layoutRef,
    leftPaneWidth,
    leftPaneMaxWidth,
    onLeftPaneWidthChange,
    paneToggleItems,
    isCommentListVisible,
    isReviewPaneVisible,
    isCommentListFilling,
    targetBranch,
    isLandingOpen,
    onTargetBranchChange,
    onOpenLanding,
    onBackClick,
    isBackAvailable,
    isShortcutHelpOpen,
    onShowShortcutHelp,
    onCloseShortcutHelp,
    onSelectPr,
    onSelectComment,
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

  // Absent in the landing view: nothing there is a comment, so starting one, picking a
  // tier for it or reviewing it in bulk are all controls for a screen that is not up.
  const runControls =
    selectedPr === null || isLandingOpen ? null : (
      <RunControls prRef={selectedPr} onOpenLanding={onOpenLanding} />
    );

  const body = (() => {
    // The gate takes the whole area: deciding to land is not something to do out of
    // the corner of an eye while the tree is still competing for attention.
    if (selectedPr !== null && isLandingOpen) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <LandingPreview
            prRef={selectedPr}
            targetBranch={targetBranch}
            onTargetBranchChange={onTargetBranchChange}
          />
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
    const reviewPane = !isReviewPaneVisible ? null : (
      /* tabIndex makes the pane a focus target for the `e` shortcut, without making it
         a tab stop in the normal order. */
      <div className={REVIEW_PANE_CLASS} ref={diffPaneRef} tabIndex={PANE_FOCUS_TAB_INDEX}>
        <CommentDetail comment={selectedComment} />
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
    const divider =
      isCommentListVisible && isReviewPaneVisible ? (
        <PaneDivider
          label={LEFT_DIVIDER_LABEL}
          edge={PANE_EDGE.LEADING}
          size={leftPaneWidth}
          minSize={LEFT_PANE_WIDTH.MIN}
          maxSize={leftPaneMaxWidth}
          onSizeChange={onLeftPaneWidthChange}
        />
      ) : null;

    return (
      <div ref={layoutRef} className={COLUMNS_CLASS}>
        {commentList}
        {divider}
        {reviewPane}
      </div>
    );
  })();

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <WorkspaceTopBar
        selectedPr={selectedPr}
        isRefreshing={isPrCommentsFetching}
        isBackAvailable={isBackAvailable}
        onBackClick={onBackClick}
        onRefreshComments={onRefreshComments}
        onShowShortcutHelp={onShowShortcutHelp}
        paneToggleItems={paneToggleItems}
      />
      {runControls}
      {body}
      <StatusBar prRef={selectedPr} comments={comments} />
      <ShortcutHelp isOpen={isShortcutHelpOpen} onClose={onCloseShortcutHelp} />
    </main>
  );
}
