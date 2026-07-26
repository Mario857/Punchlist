import { TreeRow } from '@renderer/components/TreeRow';
import type { CommentTreeRow } from '../../commentTreeModel';
import { CommentRowBadges } from '../CommentRowBadges';
import { CommentRowIcon } from '../CommentRowIcon';
import { useCommentTreeRowItem } from './useCommentTreeRowItem';

export interface CommentTreeRowItemProps {
  row: CommentTreeRow;
  /** The keyboard cursor's row; compared here so the tree stays free of row lookups. */
  focusedNodeId: string | null;
  onToggleExpanded: (nodeId: string) => void;
  onCheckedChange: (nodeId: string, isChecked: boolean) => void;
  onSelect: (nodeId: string) => void;
}

export function CommentTreeRowItem({
  row,
  focusedNodeId,
  onToggleExpanded,
  onCheckedChange,
  onSelect,
}: CommentTreeRowItemProps) {
  const {
    label,
    depth,
    hasChildren,
    isExpanded,
    isSelected,
    isFocused,
    checkedState,
    nodeKind,
    rowRef,
    onToggleRowExpanded,
    onRowCheckedChange,
    onSelectRow,
  } = useCommentTreeRowItem({ row, focusedNodeId, onToggleExpanded, onCheckedChange, onSelect });

  return (
    <TreeRow
      ref={rowRef}
      label={label}
      depth={depth}
      hasChildren={hasChildren}
      isExpanded={isExpanded}
      onToggleExpanded={onToggleRowExpanded}
      checkedState={checkedState}
      onCheckedChange={onRowCheckedChange}
      isSelected={isSelected}
      isFocused={isFocused}
      onSelect={onSelectRow}
      icon={<CommentRowIcon kind={nodeKind} />}
      badges={<CommentRowBadges row={row} />}
    />
  );
}
