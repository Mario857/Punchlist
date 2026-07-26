import { useCallback, useImperativeHandle, useState, type Ref } from 'react';
import { isDefined } from '@renderer/lib/guards';
import { clamp } from '@renderer/lib/numbers';
import { COMMENT_TREE_NODE_KIND, type CommentTreeRow } from './commentTreeModel';

/**
 * The tree keeps ownership of its row model, so the Workspace drives navigation
 * through this handle rather than by lifting the flattened rows out of the module.
 */
export interface CommentTreeNavigationHandle {
  focusNextRow: () => void;
  focusPreviousRow: () => void;
  collapseFocusedRow: () => void;
  expandFocusedRow: () => void;
}

export interface UseCommentTreeNavigationOptions {
  /**
   * The flattened *visible* rows. A collapsed subtree contributes none of its
   * descendants, which is exactly why j/k skip it without a second notion of order.
   */
  rows: readonly CommentTreeRow[];
  ref: Ref<CommentTreeNavigationHandle> | undefined;
  onSelectComment: (commentId: string) => void;
  onToggleExpanded: (nodeId: string) => void;
}

interface UseCommentTreeNavigationResult {
  focusedNodeId: string | null;
  onFocusRow: (nodeId: string) => void;
}

const NOT_FOUND_INDEX = -1;
const FIRST_ROW_INDEX = 0;
const NEXT_ROW_STEP = 1;
const PREVIOUS_ROW_STEP = -1;
const LAST_ROW_OFFSET = -1;
const EMPTY_LENGTH = 0;

export function useCommentTreeNavigation({
  rows,
  ref,
  onSelectComment,
  onToggleExpanded,
}: UseCommentTreeNavigationOptions): UseCommentTreeNavigationResult {
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // Derived rather than stored: a row pruned by a filter or hidden by a collapse
  // simply stops being found, so there is no stale index to reconcile.
  const focusedIndex = rows.findIndex((row) => row.node.id === focusedNodeId);

  const focusRowAtIndex = useCallback(
    (index: number) => {
      const row = rowAt(rows, index);
      if (!isDefined(row)) return;

      setFocusedNodeId(row.node.id);
      // Landing on a comment opens it: j/k are the review loop rather than a bare
      // cursor, so the detail and diff panes follow the focused row.
      if (row.node.kind === COMMENT_TREE_NODE_KIND.COMMENT) onSelectComment(row.node.comment.id);
    },
    [rows, onSelectComment],
  );

  const moveFocusBy = useCallback(
    (step: number) => {
      if (rows.length === EMPTY_LENGTH) return;

      // Nothing focused — and a focused row the filters pruned away reads the same —
      // so both directions enter the tree at its first row.
      const nextIndex =
        focusedIndex === NOT_FOUND_INDEX
          ? FIRST_ROW_INDEX
          : clamp(focusedIndex + step, FIRST_ROW_INDEX, rows.length + LAST_ROW_OFFSET);
      focusRowAtIndex(nextIndex);
    },
    [rows, focusedIndex, focusRowAtIndex],
  );

  const focusNextRow = useCallback(() => moveFocusBy(NEXT_ROW_STEP), [moveFocusBy]);
  const focusPreviousRow = useCallback(() => moveFocusBy(PREVIOUS_ROW_STEP), [moveFocusBy]);

  const collapseFocusedRow = useCallback(() => {
    const row = rowAt(rows, focusedIndex);
    if (!isDefined(row)) return;

    if (row.hasChildren && row.isExpanded) {
      onToggleExpanded(row.node.id);
      return;
    }
    // An already-collapsed row has nowhere to go but up, which is how left walks back
    // out of a deep path without reaching for the mouse.
    focusRowAtIndex(findParentIndex(rows, focusedIndex));
  }, [rows, focusedIndex, focusRowAtIndex, onToggleExpanded]);

  const expandFocusedRow = useCallback(() => {
    const row = rowAt(rows, focusedIndex);
    if (!isDefined(row) || !row.hasChildren) return;

    if (!row.isExpanded) {
      onToggleExpanded(row.node.id);
      return;
    }
    // Already open, so right descends — the first child is the next visible row.
    focusRowAtIndex(focusedIndex + NEXT_ROW_STEP);
  }, [rows, focusedIndex, focusRowAtIndex, onToggleExpanded]);

  useImperativeHandle(
    ref,
    () => ({ focusNextRow, focusPreviousRow, collapseFocusedRow, expandFocusedRow }),
    [focusNextRow, focusPreviousRow, collapseFocusedRow, expandFocusedRow],
  );

  return { focusedNodeId, onFocusRow: setFocusedNodeId };
}

/** `Array.at` treats a negative index as counting from the end, which a miss must not. */
function rowAt(rows: readonly CommentTreeRow[], index: number): CommentTreeRow | undefined {
  if (index < FIRST_ROW_INDEX) return undefined;
  return rows.at(index);
}

/** The nearest preceding row one level shallower — the flattened form of a parent. */
function findParentIndex(rows: readonly CommentTreeRow[], index: number): number {
  const row = rowAt(rows, index);
  if (!isDefined(row)) return NOT_FOUND_INDEX;

  for (
    let candidateIndex = index + PREVIOUS_ROW_STEP;
    candidateIndex >= FIRST_ROW_INDEX;
    candidateIndex += PREVIOUS_ROW_STEP
  ) {
    const candidate = rows.at(candidateIndex);
    if (isDefined(candidate) && candidate.depth < row.depth) return candidateIndex;
  }
  return NOT_FOUND_INDEX;
}
