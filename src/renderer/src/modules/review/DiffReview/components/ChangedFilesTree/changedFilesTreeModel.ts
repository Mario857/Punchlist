import type { CandidatePatchFile } from '@shared/runs';

export const CHANGED_FILE_KIND = {
  ADDED: 'added',
  DELETED: 'deleted',
  MODIFIED: 'modified',
} as const;

export type ChangedFileKind = (typeof CHANGED_FILE_KIND)[keyof typeof CHANGED_FILE_KIND];

export const CHANGED_FILES_NODE_KIND = {
  DIRECTORY: 'directory',
  FILE: 'file',
} as const;

export type ChangedFilesNodeKind =
  (typeof CHANGED_FILES_NODE_KIND)[keyof typeof CHANGED_FILES_NODE_KIND];

/**
 * A directory carries children and a file carries a patch, so "only a file has a
 * change kind" is a compiler guarantee rather than an optional field.
 */
export type ChangedFilesNode =
  | {
      kind: typeof CHANGED_FILES_NODE_KIND.DIRECTORY;
      id: string;
      label: string;
      children: ChangedFilesNode[];
    }
  | {
      kind: typeof CHANGED_FILES_NODE_KIND.FILE;
      id: string;
      label: string;
      path: string;
      changeKind: ChangedFileKind;
    };

export interface ChangedFilesRow {
  node: ChangedFilesNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
}

const PATH_SEPARATOR = '/';
const ROOT_PATH_PREFIX = '';
const EMPTY_LENGTH = 0;
const SINGLE_CHILD_COUNT = 1;
const ROOT_DEPTH = 0;
const DEPTH_STEP = 1;

interface DirectoryDraft {
  directories: Map<string, DirectoryDraft>;
  files: CandidatePatchFile[];
}

function createDirectoryDraft(): DirectoryDraft {
  return { directories: new Map(), files: [] };
}

export function changeKindOf(file: CandidatePatchFile): ChangedFileKind {
  if (file.originalContent.length === EMPTY_LENGTH) return CHANGED_FILE_KIND.ADDED;
  if (file.modifiedContent.length === EMPTY_LENGTH) return CHANGED_FILE_KIND.DELETED;
  return CHANGED_FILE_KIND.MODIFIED;
}

function toFileNode(file: CandidatePatchFile): ChangedFilesNode {
  const segments = file.path.split(PATH_SEPARATOR);
  return {
    kind: CHANGED_FILES_NODE_KIND.FILE,
    id: file.path,
    // `at(-1)` is possibly undefined to the compiler, but a split always yields one
    // segment, so the path itself is the correct fallback rather than a guard.
    label: segments.at(-1) ?? file.path,
    path: file.path,
    changeKind: changeKindOf(file),
  };
}

function toNodes(draft: DirectoryDraft, pathPrefix: string): ChangedFilesNode[] {
  const directoryNodes: ChangedFilesNode[] = [];

  for (const [name, child] of [...draft.directories].sort(([a], [b]) => a.localeCompare(b))) {
    const id = pathPrefix.length === EMPTY_LENGTH ? name : `${pathPrefix}${PATH_SEPARATOR}${name}`;
    const children = toNodes(child, id);

    // Single-child chains collapse: `src/renderer/src/hooks` is one row, not four.
    // Without this, path depth alone buries the files the patch actually touched.
    const onlyChild = children.length === SINGLE_CHILD_COUNT ? children[0] : undefined;
    if (onlyChild !== undefined && onlyChild.kind === CHANGED_FILES_NODE_KIND.DIRECTORY) {
      directoryNodes.push({
        kind: CHANGED_FILES_NODE_KIND.DIRECTORY,
        id: onlyChild.id,
        label: `${name}${PATH_SEPARATOR}${onlyChild.label}`,
        children: onlyChild.children,
      });
      continue;
    }

    directoryNodes.push({
      kind: CHANGED_FILES_NODE_KIND.DIRECTORY,
      id,
      label: name,
      children,
    });
  }

  const fileNodes = [...draft.files].sort((a, b) => a.path.localeCompare(b.path)).map(toFileNode);

  // Directories first: a mixed alphabetical list makes the shape of a patch harder to
  // read than the extra grouping costs.
  return [...directoryNodes, ...fileNodes];
}

export function buildChangedFilesTree(files: readonly CandidatePatchFile[]): ChangedFilesNode[] {
  const root = createDirectoryDraft();

  for (const file of files) {
    const segments = file.path.split(PATH_SEPARATOR);
    const directorySegments = segments.slice(ROOT_DEPTH, -DEPTH_STEP);

    let cursor = root;
    for (const segment of directorySegments) {
      const existing = cursor.directories.get(segment);
      if (existing === undefined) {
        const created = createDirectoryDraft();
        cursor.directories.set(segment, created);
        cursor = created;
        continue;
      }
      cursor = existing;
    }
    cursor.files.push(file);
  }

  return toNodes(root, ROOT_PATH_PREFIX);
}

export interface FlattenChangedFilesTreeOptions {
  nodes: readonly ChangedFilesNode[];
  /** Collapsed rather than expanded ids, so a freshly built tree is fully open. */
  collapsedNodeIds: ReadonlySet<string>;
  selectedPath: string | null;
}

export function flattenChangedFilesTree({
  nodes,
  collapsedNodeIds,
  selectedPath,
}: FlattenChangedFilesTreeOptions): ChangedFilesRow[] {
  const rows: ChangedFilesRow[] = [];

  const visit = (node: ChangedFilesNode, depth: number): void => {
    if (node.kind === CHANGED_FILES_NODE_KIND.FILE) {
      rows.push({
        node,
        depth,
        hasChildren: false,
        isExpanded: false,
        isSelected: node.path === selectedPath,
      });
      return;
    }

    const isExpanded = !collapsedNodeIds.has(node.id);
    rows.push({
      node,
      depth,
      hasChildren: node.children.length > EMPTY_LENGTH,
      isExpanded,
      isSelected: false,
    });
    if (!isExpanded) return;
    for (const child of node.children) visit(child, depth + DEPTH_STEP);
  };

  for (const node of nodes) visit(node, ROOT_DEPTH);
  return rows;
}
