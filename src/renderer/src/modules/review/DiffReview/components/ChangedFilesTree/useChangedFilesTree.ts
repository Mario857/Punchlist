import { useCallback, useMemo, useState } from 'react';
import type { CandidatePatchFile } from '@shared/runs';
import { BADGE_TONE, type BadgeTone } from '@renderer/components/Badge';
import { assertNever } from '@renderer/lib/assertNever';
import {
  buildChangedFilesTree,
  CHANGED_FILES_NODE_KIND,
  CHANGED_FILE_KIND,
  flattenChangedFilesTree,
  type ChangedFileKind,
  type ChangedFilesNodeKind,
} from './changedFilesTreeModel';

export interface UseChangedFilesTreeOptions {
  files: readonly CandidatePatchFile[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
}

export interface ChangedFilesRowItem {
  key: string;
  label: string;
  depth: number;
  nodeKind: ChangedFilesNodeKind;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  /** Null on a directory: only a file carries a change kind. */
  changeBadgeLabel: string | null;
  changeBadgeTone: BadgeTone;
  changeBadgeTitle: string;
  onToggleExpanded: () => void;
  onSelect: () => void;
}

interface UseChangedFilesTreeResult {
  rowItems: ChangedFilesRowItem[];
  fileCountLabel: string;
}

const CHANGE_BADGE_LABEL: Record<ChangedFileKind, string> = {
  [CHANGED_FILE_KIND.ADDED]: 'A',
  [CHANGED_FILE_KIND.DELETED]: 'D',
  [CHANGED_FILE_KIND.MODIFIED]: 'M',
};

const CHANGE_BADGE_TITLE: Record<ChangedFileKind, string> = {
  [CHANGED_FILE_KIND.ADDED]: 'Added',
  [CHANGED_FILE_KIND.DELETED]: 'Deleted',
  [CHANGED_FILE_KIND.MODIFIED]: 'Modified',
};

const CHANGE_BADGE_TONE: Record<ChangedFileKind, BadgeTone> = {
  [CHANGED_FILE_KIND.ADDED]: BADGE_TONE.SUCCESS,
  [CHANGED_FILE_KIND.DELETED]: BADGE_TONE.DANGER,
  [CHANGED_FILE_KIND.MODIFIED]: BADGE_TONE.INFO,
};

const DIRECTORY_BADGE_TONE = BADGE_TONE.NEUTRAL;
const DIRECTORY_BADGE_TITLE = 'Directory';
const SINGLE_FILE_COUNT_LABEL = '1 file changed';
const SINGLE_COUNT = 1;

export function useChangedFilesTree({
  files,
  selectedPath,
  onSelectPath,
}: UseChangedFilesTreeOptions): UseChangedFilesTreeResult {
  // Collapsed rather than expanded ids, so a patch opens fully visible and a fresh
  // fetch never needs its expansion state seeded from the data.
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<ReadonlySet<string>>(new Set());

  const nodes = useMemo(() => buildChangedFilesTree(files), [files]);

  const rows = useMemo(
    () => flattenChangedFilesTree({ nodes, collapsedNodeIds, selectedPath }),
    [nodes, collapsedNodeIds, selectedPath],
  );

  const onToggleNode = useCallback((nodeId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const rowItems = useMemo(
    () =>
      rows.map((row) => {
        const { node } = row;
        const changeBadge = (() => {
          switch (node.kind) {
            case CHANGED_FILES_NODE_KIND.FILE:
              return {
                label: CHANGE_BADGE_LABEL[node.changeKind],
                tone: CHANGE_BADGE_TONE[node.changeKind],
                title: CHANGE_BADGE_TITLE[node.changeKind],
              };
            case CHANGED_FILES_NODE_KIND.DIRECTORY:
              return { label: null, tone: DIRECTORY_BADGE_TONE, title: DIRECTORY_BADGE_TITLE };
            default:
              return assertNever(node);
          }
        })();

        const onSelect =
          node.kind === CHANGED_FILES_NODE_KIND.FILE
            ? () => onSelectPath(node.path)
            : () => onToggleNode(node.id);

        return {
          key: node.id,
          label: node.label,
          depth: row.depth,
          nodeKind: node.kind,
          hasChildren: row.hasChildren,
          isExpanded: row.isExpanded,
          isSelected: row.isSelected,
          changeBadgeLabel: changeBadge.label,
          changeBadgeTone: changeBadge.tone,
          changeBadgeTitle: changeBadge.title,
          onToggleExpanded: () => onToggleNode(node.id),
          onSelect,
        };
      }),
    [rows, onSelectPath, onToggleNode],
  );

  const fileCountLabel =
    files.length === SINGLE_COUNT ? SINGLE_FILE_COUNT_LABEL : `${files.length} files changed`;

  return { rowItems, fileCountLabel };
}
