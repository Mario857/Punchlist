import type { PrComment } from '@shared/comments';
import { FileIcon } from '@renderer/components/icons/FileIcon';
import { CommentDetailBody } from '@renderer/modules/review/CommentDetail/components/CommentDetailBody';
import { useCommentDetail } from '@renderer/modules/review/CommentDetail/useCommentDetail';

export interface CommentDetailProps {
  comment: PrComment | null;
}

const EMPTY_STATE_ICON_SIZE = 20;

export function CommentDetail({ comment }: CommentDetailProps) {
  const { detail, emptyStateLabel } = useCommentDetail(comment);

  const emptyState = (
    <div className="text-muted flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
      <FileIcon size={EMPTY_STATE_ICON_SIZE} className="text-muted/60" />
      <p>{emptyStateLabel}</p>
    </div>
  );

  const content = detail === null ? emptyState : <CommentDetailBody detail={detail} />;

  return (
    <section aria-label="Comment detail" className="flex h-full min-h-0 flex-col overflow-y-auto">
      {content}
    </section>
  );
}
