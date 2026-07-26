import { TreeRow } from '@renderer/components/TreeRow';
import type { CommentTreeRow } from '../../commentTreeModel';
import { CommentRowBadges } from '../CommentRowBadges';
import { CommentRowIcon } from '../CommentRowIcon';
import { useCommentTreeRowItem } from './useCommentTreeRowItem';

export interface CommentTreeRowItemProps {
  row: CommentTreeRow;
  onToggleExpanded: (nodeId: string) => void;
  onCheckedChange: (nodeId: string, isChecked: boolean) => void;
  onSelect: (nodeId: string) => void;
}

export function CommentTreeRowItem({
  row,
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
    checkedState,
    nodeKind,
    onToggleRowExpanded,
    onRowCheckedChange,
    onSelectRow,
  } = useCommentTreeRowItem({ row, onToggleExpanded, onCheckedChange, onSelect });

  return (
    <TreeRow
      label={label}
      depth={depth}
      hasChildren={hasChildren}
      isExpanded={isExpanded}
      onToggleExpanded={onToggleRowExpanded}
      checkedState={checkedState}
      onCheckedChange={onRowCheckedChange}
      isSelected={isSelected}
      onSelect={onSelectRow}
      icon={<CommentRowIcon kind={nodeKind} />}
      badges={<CommentRowBadges row={row} />}
    />
  );
}
