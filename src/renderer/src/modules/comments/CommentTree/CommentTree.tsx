import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import type { RunState } from '@shared/runState';
import { CommentTreeRowItem } from './components/CommentTreeRowItem/CommentTreeRowItem';
import { useCommentTree } from './useCommentTree';

export interface CommentTreeProps {
  prRef: PrRef;
  /** The full fetched set. Filters prune the tree here, never at fetch time. */
  comments: PrComment[];
  selectedCommentId: string | null;
  onSelectComment: (commentId: string) => void;
  /** Empty until phase 2 introduces runs. Drives the attention-budget behaviour. */
  runStateByCommentId?: Readonly<Record<string, RunState>>;
}

const TREE_ARIA_LABEL = 'Pull request comments';

const TREE_CLASS = 'flex flex-col gap-0.5 p-1';
const EMPTY_STATE_CLASS = 'text-muted px-3 py-8 text-center text-sm';

export function CommentTree({
  prRef,
  comments,
  selectedCommentId,
  onSelectComment,
  runStateByCommentId,
}: CommentTreeProps) {
  const { rows, isEmpty, emptyStateLabel, onToggleExpanded, onCheckedChange, onSelectRow } =
    useCommentTree({ prRef, comments, selectedCommentId, onSelectComment, runStateByCommentId });

  const rowItems = rows.map((row) => (
    <CommentTreeRowItem
      key={row.node.id}
      row={row}
      onToggleExpanded={onToggleExpanded}
      onCheckedChange={onCheckedChange}
      onSelect={onSelectRow}
    />
  ));

  const content = isEmpty ? (
    <p className={EMPTY_STATE_CLASS}>{emptyStateLabel}</p>
  ) : (
    <div role="tree" aria-label={TREE_ARIA_LABEL} aria-multiselectable className={TREE_CLASS}>
      {rowItems}
    </div>
  );

  return content;
}
