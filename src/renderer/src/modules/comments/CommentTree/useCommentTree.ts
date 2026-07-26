import { useCallback, useMemo, type Ref } from 'react';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import type { RunState } from '@shared/runState';
import { keyBy } from '@renderer/lib/collections';
import { isDefined } from '@renderer/lib/guards';
import { useSessionStore } from '@renderer/stores/sessionStore';
import {
  COMMENT_TREE_NODE_KIND,
  buildCommentTree,
  flattenCommentTree,
  selectionTargetsOf,
  type CommentTreeRow,
} from './commentTreeModel';
import {
  useCommentTreeNavigation,
  type CommentTreeNavigationHandle,
} from './useCommentTreeNavigation';
import { useTreeExpansion } from './useTreeExpansion';

export interface UseCommentTreeOptions {
  prRef: PrRef;
  comments: readonly PrComment[];
  selectedCommentId: string | null;
  onSelectComment: (commentId: string) => void;
  runStateByCommentId?: Readonly<Record<string, RunState>>;
  navigationRef: Ref<CommentTreeNavigationHandle> | undefined;
}

interface UseCommentTreeResult {
  rows: CommentTreeRow[];
  isEmpty: boolean;
  emptyStateLabel: string;
  /** The keyboard cursor, distinct from the selection that drives the detail pane. */
  focusedNodeId: string | null;
  onToggleExpanded: (nodeId: string) => void;
  onCheckedChange: (nodeId: string, isChecked: boolean) => void;
  onSelectRow: (nodeId: string) => void;
}

/** Frozen and module-level so an absent prop is a stable dependency, not a new object. */
const EMPTY_RUN_STATE_BY_COMMENT_ID: Readonly<Record<string, RunState>> = Object.freeze({});

const NO_COMMENTS_LABEL = 'No comments on this pull request.';
const NO_MATCHES_LABEL = 'No comments match the current filters.';

const EMPTY_LENGTH = 0;

export function useCommentTree({
  prRef,
  comments,
  selectedCommentId,
  onSelectComment,
  runStateByCommentId = EMPTY_RUN_STATE_BY_COMMENT_ID,
  navigationRef,
}: UseCommentTreeOptions): UseCommentTreeResult {
  const filters = useSessionStore((state) => state.filters);
  const persistedSelectedCommentIds = useSessionStore((state) => state.selectedCommentIds);
  const setSelectedCommentIds = useSessionStore((state) => state.setSelectedCommentIds);
  const toggleCommentSelection = useSessionStore((state) => state.toggleCommentSelection);

  const nodes = useMemo(
    () => buildCommentTree({ comments, filters, runStateByCommentId }),
    [comments, filters, runStateByCommentId],
  );

  const { expandedNodeIds, onToggleExpanded } = useTreeExpansion({
    prRef,
    nodes,
    runStateByCommentId,
  });

  const selectedCommentIds = useMemo(
    () => new Set(persistedSelectedCommentIds),
    [persistedSelectedCommentIds],
  );

  const rows = useMemo(
    () =>
      flattenCommentTree({
        nodes,
        expandedNodeIds,
        runStateByCommentId,
        selectedCommentIds,
        selectedCommentId,
      }),
    [nodes, expandedNodeIds, runStateByCommentId, selectedCommentIds, selectedCommentId],
  );

  // Only a visible row can be clicked, so the visible rows are the whole lookup.
  const nodesById = useMemo(() => keyBy(rows, (row) => row.node.id), [rows]);

  const { focusedNodeId, onFocusRow } = useCommentTreeNavigation({
    rows,
    ref: navigationRef,
    onSelectComment,
    onToggleExpanded,
  });

  const onCheckedChange = useCallback(
    (nodeId: string, isChecked: boolean) => {
      const row = nodesById.get(nodeId);
      if (!isDefined(row)) return;

      if (row.node.kind === COMMENT_TREE_NODE_KIND.COMMENT) {
        toggleCommentSelection(row.node.comment.id);
        return;
      }

      const nextCommentIds = new Set(selectedCommentIds);
      for (const commentId of selectionTargetsOf(row.node)) {
        if (isChecked) nextCommentIds.add(commentId);
        else nextCommentIds.delete(commentId);
      }
      setSelectedCommentIds([...nextCommentIds]);
    },
    [nodesById, selectedCommentIds, setSelectedCommentIds, toggleCommentSelection],
  );

  const onSelectRow = useCallback(
    (nodeId: string) => {
      const row = nodesById.get(nodeId);
      if (!isDefined(row)) return;

      // Clicking moves the keyboard cursor too, so j after a click continues from
      // where the pointer left off rather than from an invisible earlier position.
      onFocusRow(nodeId);

      if (row.node.kind === COMMENT_TREE_NODE_KIND.COMMENT) {
        onSelectComment(row.node.comment.id);
        return;
      }
      // A directory has nothing to show in the detail pane, so its label opens it.
      onToggleExpanded(row.node.id);
    },
    [nodesById, onFocusRow, onSelectComment, onToggleExpanded],
  );

  const isEmpty = rows.length === EMPTY_LENGTH;
  const emptyStateLabel = comments.length === EMPTY_LENGTH ? NO_COMMENTS_LABEL : NO_MATCHES_LABEL;

  return {
    rows,
    isEmpty,
    emptyStateLabel,
    focusedNodeId,
    onToggleExpanded,
    onCheckedChange,
    onSelectRow,
  };
}
