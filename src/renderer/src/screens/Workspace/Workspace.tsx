import { Spinner } from '@renderer/components/Spinner';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { CommentTree } from '@renderer/modules/comments/CommentTree/CommentTree';
import { FilterBar } from '@renderer/modules/comments/FilterBar/FilterBar';
import { PrPicker } from '@renderer/modules/discovery/PrPicker/PrPicker';
import { CommentDetail } from '@renderer/modules/review/CommentDetail/CommentDetail';
import { ResolutionPane } from './components/ResolutionPane';
import { WorkspaceTopBar } from './components/WorkspaceTopBar';
import { useWorkspace } from './useWorkspace';

const LEFT_PANE_CLASS = 'border-border flex w-80 shrink-0 flex-col overflow-hidden border-r';
const CENTER_PANE_CLASS = 'border-border min-w-0 flex-1 overflow-y-auto border-r';
const RIGHT_PANE_CLASS = 'w-96 shrink-0 overflow-y-auto';
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
          />
        </div>
      </>
    );
  })();

  const body = (() => {
    // The picker takes the whole area when no PR is chosen: there is nothing to lay
    // three panes out around yet.
    if (selectedPr === null || isPickerOpen) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <PrPicker selectedPr={selectedPr} onSelectPr={onSelectPr} />
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1">
        <div className={LEFT_PANE_CLASS}>{leftPane}</div>
        <div className={CENTER_PANE_CLASS}>
          <CommentDetail comment={selectedComment} />
        </div>
        <div className={RIGHT_PANE_CLASS}>
          <ResolutionPane />
        </div>
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
      />
      {body}
    </main>
  );
}
