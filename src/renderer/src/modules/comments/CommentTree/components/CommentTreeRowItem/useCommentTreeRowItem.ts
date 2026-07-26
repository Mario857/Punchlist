import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { TreeRowCheckedState } from '@renderer/components/TreeRow';
import type { CommentTreeNodeKind, CommentTreeRow } from '../../commentTreeModel';

export interface UseCommentTreeRowItemOptions {
  row: CommentTreeRow;
  focusedNodeId: string | null;
  onToggleExpanded: (nodeId: string) => void;
  onCheckedChange: (nodeId: string, isChecked: boolean) => void;
  onSelect: (nodeId: string) => void;
}

interface UseCommentTreeRowItemResult {
  label: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  checkedState: TreeRowCheckedState | undefined;
  nodeKind: CommentTreeNodeKind;
  rowRef: RefObject<HTMLDivElement | null>;
  onToggleRowExpanded: () => void;
  onRowCheckedChange: (isChecked: boolean) => void;
  onSelectRow: () => void;
}

/** Enough to bring the row inside the viewport without recentring the whole tree. */
const SCROLL_BLOCK: ScrollLogicalPosition = 'nearest';

/**
 * The tree's handlers are keyed by node id so one set of callbacks serves every row;
 * binding the id happens here rather than in an arrow inside the parent's markup.
 */
export function useCommentTreeRowItem({
  row,
  focusedNodeId,
  onToggleExpanded,
  onCheckedChange,
  onSelect,
}: UseCommentTreeRowItemOptions): UseCommentTreeRowItemResult {
  const nodeId = row.node.id;
  const isFocused = nodeId === focusedNodeId;
  const rowRef = useRef<HTMLDivElement>(null);

  /**
   * Roving tabindex, so the keyboard cursor is real DOM focus rather than a painted
   * outline a screen reader cannot see. Scrolling is explicit and separate because
   * `focus` alone would recentre a long tree on every j.
   */
  useEffect(() => {
    const element = rowRef.current;
    if (!isFocused || element === null) return;

    // A click already focused one of the row's own controls; stealing that focus back
    // to the container would drop the ring off the button the user just pressed.
    if (!element.contains(document.activeElement)) element.focus({ preventScroll: true });
    element.scrollIntoView({ block: SCROLL_BLOCK });
  }, [isFocused]);

  const onToggleRowExpanded = useCallback(() => {
    onToggleExpanded(nodeId);
  }, [nodeId, onToggleExpanded]);

  const onRowCheckedChange = useCallback(
    (isChecked: boolean) => {
      onCheckedChange(nodeId, isChecked);
    },
    [nodeId, onCheckedChange],
  );

  const onSelectRow = useCallback(() => {
    onSelect(nodeId);
  }, [nodeId, onSelect]);

  return {
    label: row.node.label,
    depth: row.depth,
    hasChildren: row.hasChildren,
    isExpanded: row.isExpanded,
    isSelected: row.isSelected,
    isFocused,
    checkedState: row.checkedState,
    nodeKind: row.node.kind,
    rowRef,
    onToggleRowExpanded,
    onRowCheckedChange,
    onSelectRow,
  };
}
