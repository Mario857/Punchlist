import { useCallback } from 'react';
import type { TreeRowCheckedState } from '@renderer/components/TreeRow';
import type { CommentTreeNodeKind, CommentTreeRow } from '../../commentTreeModel';

export interface UseCommentTreeRowItemOptions {
  row: CommentTreeRow;
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
  checkedState: TreeRowCheckedState | undefined;
  nodeKind: CommentTreeNodeKind;
  onToggleRowExpanded: () => void;
  onRowCheckedChange: (isChecked: boolean) => void;
  onSelectRow: () => void;
}

/**
 * The tree's handlers are keyed by node id so one set of callbacks serves every row;
 * binding the id happens here rather than in an arrow inside the parent's markup.
 */
export function useCommentTreeRowItem({
  row,
  onToggleExpanded,
  onCheckedChange,
  onSelect,
}: UseCommentTreeRowItemOptions): UseCommentTreeRowItemResult {
  const nodeId = row.node.id;

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
    checkedState: row.checkedState,
    nodeKind: row.node.kind,
    onToggleRowExpanded,
    onRowCheckedChange,
    onSelectRow,
  };
}
