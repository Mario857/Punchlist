import type { ReactNode } from 'react';
import type { CandidatePatchFile } from '@shared/runs';
import { Badge, BADGE_SIZE } from '@renderer/components/Badge';
import { TreeRow } from '@renderer/components/TreeRow';
import { FileIcon } from '@renderer/components/icons/FileIcon';
import { FolderIcon } from '@renderer/components/icons/FolderIcon';
import { CHANGED_FILES_NODE_KIND, type ChangedFilesNodeKind } from './changedFilesTreeModel';
import { useChangedFilesTree } from './useChangedFilesTree';

export interface ChangedFilesTreeProps {
  files: readonly CandidatePatchFile[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
}

const TREE_ARIA_LABEL = 'Files this patch touches';
const ROW_ICON_SIZE = 12;

/**
 * A Record over the node kind rather than a ternary: adding a kind becomes a compile
 * error instead of silently rendering a file glyph on something that is not a file.
 */
const ROW_ICON: Record<ChangedFilesNodeKind, ReactNode> = {
  [CHANGED_FILES_NODE_KIND.DIRECTORY]: (
    <FolderIcon size={ROW_ICON_SIZE} className="text-muted/70" />
  ),
  [CHANGED_FILES_NODE_KIND.FILE]: <FileIcon size={ROW_ICON_SIZE} className="text-muted/70" />,
};

export function ChangedFilesTree({ files, selectedPath, onSelectPath }: ChangedFilesTreeProps) {
  const { rowItems, fileCountLabel } = useChangedFilesTree({ files, selectedPath, onSelectPath });

  const rows = rowItems.map((item) => {
    const badge =
      item.changeBadgeLabel === null ? null : (
        <Badge
          tone={item.changeBadgeTone}
          size={BADGE_SIZE.SM}
          isMuted
          title={item.changeBadgeTitle}
        >
          {item.changeBadgeLabel}
        </Badge>
      );

    return (
      <TreeRow
        key={item.key}
        label={item.label}
        depth={item.depth}
        hasChildren={item.hasChildren}
        isExpanded={item.isExpanded}
        onToggleExpanded={item.onToggleExpanded}
        isSelected={item.isSelected}
        onSelect={item.onSelect}
        icon={ROW_ICON[item.nodeKind]}
        badges={badge}
      />
    );
  });

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <p className="text-muted text-xs">{fileCountLabel}</p>
      <div
        role="tree"
        aria-label={TREE_ARIA_LABEL}
        className="flex min-h-0 flex-col gap-0.5 overflow-y-auto"
      >
        {rows}
      </div>
    </div>
  );
}
