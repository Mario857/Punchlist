import {
  isInlineThread,
  matchesCommentFilters,
  isRecommendedForRun,
  type CommentFilters,
  type InlineThreadComment,
  type PrComment,
} from '@shared/comments';
import {
  RUN_STATE,
  mostUrgentRunState,
  shouldAttractAttention,
  shouldSelfCollapse,
  type RunState,
} from '@shared/runState';
import { TREE_ROW_CHECKED_STATE, type TreeRowCheckedState } from '@renderer/components/TreeRow';
import { isDefined } from '@renderer/lib/guards';

export const COMMENT_TREE_NODE_KIND = {
  /** The pinned node holding every comment without an anchor. */
  PR_CONVERSATION: 'prConversation',
  DIRECTORY: 'directory',
  FILE: 'file',
  COMMENT: 'comment',
} as const;

export type CommentTreeNodeKind =
  (typeof COMMENT_TREE_NODE_KIND)[keyof typeof COMMENT_TREE_NODE_KIND];

export type CommentTreeGroupKind =
  | typeof COMMENT_TREE_NODE_KIND.PR_CONVERSATION
  | typeof COMMENT_TREE_NODE_KIND.DIRECTORY
  | typeof COMMENT_TREE_NODE_KIND.FILE;

export interface CommentTreeGroupNode {
  kind: CommentTreeGroupKind;
  id: string;
  label: string;
  children: CommentTreeNode[];
  /** Every comment in the subtree, so a collapsed node still rolls up count and state. */
  descendantCommentIds: string[];
  /** The subset a group-level check selects: actionable descendants only. */
  actionableCommentIds: string[];
}

export interface CommentTreeCommentNode {
  kind: typeof COMMENT_TREE_NODE_KIND.COMMENT;
  id: string;
  label: string;
  comment: PrComment;
}

export type CommentTreeNode = CommentTreeGroupNode | CommentTreeCommentNode;

/** One rendered row: a node plus everything about it that depends on the view. */
export interface CommentTreeRow {
  node: CommentTreeNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  /** The single-row focus that drives the detail pane, not the batch selection. */
  isSelected: boolean;
  /** Rolled up across the subtree for a group row, the comment's own state for a leaf. */
  runState: RunState | null;
  /** Undefined renders no checkbox at all: a group with nothing actionable in it. */
  checkedState: TreeRowCheckedState | undefined;
}

export interface TriageSummary {
  decidedCount: number;
  totalCount: number;
}

export const PR_CONVERSATION_NODE_ID = 'prConversation';

/** Two levels open by default: enough to reveal files, not every comment on them. */
export const DEFAULT_EXPANDED_DEPTH = 2;

export const ROOT_TREE_DEPTH = 0;

const DEPTH_STEP = 1;

const PATH_SEPARATOR = '/';
const ROOT_DIRECTORY_PATH = '';
const PR_CONVERSATION_LABEL = 'PR conversation';
const DIRECTORY_NODE_ID_PREFIX = 'dir:';
const FILE_NODE_ID_PREFIX = 'file:';
const COMMENT_NODE_ID_PREFIX = 'comment:';

/** A directory with exactly one directory child is a link in a chain, not a fork. */
const SINGLE_CHILD_CHAIN_LENGTH = 1;

const COMMENT_LABEL_MAX_LENGTH = 72;
const ELLIPSIS = '…';
const EMPTY_BODY_LABEL = '(empty comment)';
const AUTHOR_LABEL_SEPARATOR = ': ';
const WHITESPACE_RUN = /\s+/g;
const SINGLE_SPACE = ' ';

const EMPTY_LENGTH = 0;
const TEXT_START_INDEX = 0;
const LAST_INDEX = -1;

const SORT_BEFORE = -1;
const SORT_AFTER = 1;
const SORT_EQUAL = 0;

/**
 * Directories group above files at the same level. The pinned conversation node is
 * prepended rather than sorted, so its entry here only keeps the ordering total.
 */
const NODE_KIND_ORDER: readonly CommentTreeNodeKind[] = [
  COMMENT_TREE_NODE_KIND.PR_CONVERSATION,
  COMMENT_TREE_NODE_KIND.DIRECTORY,
  COMMENT_TREE_NODE_KIND.FILE,
  COMMENT_TREE_NODE_KIND.COMMENT,
];

export interface BuildCommentTreeOptions {
  comments: readonly PrComment[];
  filters: CommentFilters;
  runStateByCommentId: Readonly<Record<string, RunState>>;
}

export interface FlattenCommentTreeOptions {
  nodes: readonly CommentTreeNode[];
  expandedNodeIds: ReadonlySet<string>;
  runStateByCommentId: Readonly<Record<string, RunState>>;
  selectedCommentIds: ReadonlySet<string>;
  selectedCommentId: string | null;
}

interface DirectoryBuilder {
  path: string;
  segment: string;
  directoriesBySegment: Map<string, DirectoryBuilder>;
  commentsByFilePath: Map<string, InlineThreadComment[]>;
}

/**
 * Filters prune the tree rather than filtering rows in place: a directory emptied by
 * a filter disappears instead of remaining as a header over nothing.
 */
export function buildCommentTree({
  comments,
  filters,
  runStateByCommentId,
}: BuildCommentTreeOptions): CommentTreeNode[] {
  const root = createDirectoryBuilder(ROOT_DIRECTORY_PATH, ROOT_DIRECTORY_PATH);
  const unanchoredComments: PrComment[] = [];

  for (const comment of comments) {
    if (!matchesCommentFilters(comment, filters)) continue;
    if (isInlineThread(comment)) insertAnchoredComment(root, comment);
    else unanchoredComments.push(comment);
  }

  const pathNodes = buildDirectoryChildren(root, runStateByCommentId);
  if (unanchoredComments.length === EMPTY_LENGTH) return pathNodes;

  const conversationNode = createGroupNode(
    COMMENT_TREE_NODE_KIND.PR_CONVERSATION,
    PR_CONVERSATION_NODE_ID,
    PR_CONVERSATION_LABEL,
    sortNodes(unanchoredComments.map(createCommentNode), runStateByCommentId),
  );

  // Pinned first rather than sorted among real paths: reviewBody and conversation
  // comments have no anchor, and a "No file" group sorted alphabetically hides them.
  return [conversationNode, ...pathNodes];
}

export function flattenCommentTree(options: FlattenCommentTreeOptions): CommentTreeRow[] {
  const rows: CommentTreeRow[] = [];
  appendRows(options.nodes, ROOT_TREE_DEPTH, options, rows);
  return rows;
}

/**
 * Only subtrees holding something blocked or flagged open themselves; a subtree that
 * is entirely applied or noActionNeeded collapses. With no runs yet there is nothing
 * to attract attention, so the depth default stands in.
 */
export function defaultExpandedNodeIds(
  nodes: readonly CommentTreeNode[],
  runStateByCommentId: Readonly<Record<string, RunState>>,
): string[] {
  const expandedNodeIds: string[] = [];
  appendDefaultExpanded(nodes, ROOT_TREE_DEPTH, runStateByCommentId, expandedNodeIds);
  return expandedNodeIds;
}

export function rollUpRunState(
  node: CommentTreeNode,
  runStateByCommentId: Readonly<Record<string, RunState>>,
): RunState | null {
  if (node.kind === COMMENT_TREE_NODE_KIND.COMMENT) {
    return runStateByCommentId[node.comment.id] ?? null;
  }
  return mostUrgentRunState(collectRunStates(node.descendantCommentIds, runStateByCommentId));
}

/**
 * What checking this row selects. A comment row toggles itself even when it is not
 * actionable — re-running a resolved thread is a deliberate choice — while a group
 * check takes only the actionable descendants, so checking a directory can never
 * queue work against outdated or already-resolved threads.
 */
export function selectionTargetsOf(node: CommentTreeNode): readonly string[] {
  if (node.kind === COMMENT_TREE_NODE_KIND.COMMENT) return [node.comment.id];
  return node.actionableCommentIds;
}

/**
 * Triage counts what no longer needs a decision. Before any run exists that is the
 * threads GitHub already reports resolved, which is why the counter reads as a
 * bounded task on a freshly opened PR instead of starting at zero of zero.
 */
export function summarizeTriage(comments: readonly PrComment[]): TriageSummary {
  const decidedCount = comments.filter(isCommentDecided).length;
  return { decidedCount, totalCount: comments.length };
}

export function collectAuthorLogins(comments: readonly PrComment[]): string[] {
  const logins = comments.map((comment) => comment.author.login);
  return [...new Set(logins)].sort(compareLabels);
}

export function collectCommentPaths(comments: readonly PrComment[]): string[] {
  const paths = comments.filter(isInlineThread).map((comment) => comment.anchor.path);
  return [...new Set(paths)].sort(compareLabels);
}

function isCommentDecided(comment: PrComment): boolean {
  return isInlineThread(comment) && comment.isResolved;
}

function createDirectoryBuilder(path: string, segment: string): DirectoryBuilder {
  return { path, segment, directoriesBySegment: new Map(), commentsByFilePath: new Map() };
}

function insertAnchoredComment(root: DirectoryBuilder, comment: InlineThreadComment): void {
  const segments = comment.anchor.path
    .split(PATH_SEPARATOR)
    .filter((segment) => segment.length > EMPTY_LENGTH);
  const fileName = segments.at(LAST_INDEX);
  // A thread always carries a path, so this only narrows away the empty-path case.
  if (!isDefined(fileName)) return;

  let directory = root;
  for (const segment of segments.slice(TEXT_START_INDEX, LAST_INDEX)) {
    const existing = directory.directoriesBySegment.get(segment);
    const child = existing ?? createDirectoryBuilder(joinPath(directory.path, segment), segment);
    if (!isDefined(existing)) directory.directoriesBySegment.set(segment, child);
    directory = child;
  }

  const fileComments = directory.commentsByFilePath.get(comment.anchor.path);
  if (isDefined(fileComments)) fileComments.push(comment);
  else directory.commentsByFilePath.set(comment.anchor.path, [comment]);
}

function joinPath(parentPath: string, segment: string): string {
  if (parentPath === ROOT_DIRECTORY_PATH) return segment;
  return `${parentPath}${PATH_SEPARATOR}${segment}`;
}

function buildDirectoryChildren(
  builder: DirectoryBuilder,
  runStateByCommentId: Readonly<Record<string, RunState>>,
): CommentTreeNode[] {
  const directoryNodes = [...builder.directoriesBySegment.values()].map((child) =>
    buildDirectoryNode(child, runStateByCommentId),
  );
  const fileNodes = [...builder.commentsByFilePath.entries()].map(([filePath, comments]) =>
    buildFileNode(filePath, comments, runStateByCommentId),
  );
  return sortNodes([...directoryNodes, ...fileNodes], runStateByCommentId);
}

function buildDirectoryNode(
  builder: DirectoryBuilder,
  runStateByCommentId: Readonly<Record<string, RunState>>,
): CommentTreeGroupNode {
  const node = createGroupNode(
    COMMENT_TREE_NODE_KIND.DIRECTORY,
    `${DIRECTORY_NODE_ID_PREFIX}${builder.path}`,
    builder.segment,
    buildDirectoryChildren(builder, runStateByCommentId),
  );
  return collapseSingleChildChain(node);
}

function buildFileNode(
  filePath: string,
  comments: readonly InlineThreadComment[],
  runStateByCommentId: Readonly<Record<string, RunState>>,
): CommentTreeGroupNode {
  const fileName = filePath.split(PATH_SEPARATOR).at(LAST_INDEX) ?? filePath;
  return createGroupNode(
    COMMENT_TREE_NODE_KIND.FILE,
    `${FILE_NODE_ID_PREFIX}${filePath}`,
    fileName,
    sortNodes(comments.map(createCommentNode), runStateByCommentId),
  );
}

/**
 * `src/renderer/src/hooks` renders as one node, not four: JavaScript path depth alone
 * would bury the comments. Only directory chains collapse — a file keeps its own row,
 * because its children are comments rather than more path.
 */
function collapseSingleChildChain(node: CommentTreeGroupNode): CommentTreeGroupNode {
  let collapsed = node;
  while (collapsed.children.length === SINGLE_CHILD_CHAIN_LENGTH) {
    const [child] = collapsed.children;
    if (child.kind !== COMMENT_TREE_NODE_KIND.DIRECTORY) break;
    // The child's id is the deeper path, which is what keeps persisted expansion
    // stable when a sibling appears and the chain stops collapsing.
    collapsed = { ...child, label: joinPath(collapsed.label, child.label) };
  }
  return collapsed;
}

function createGroupNode(
  kind: CommentTreeGroupKind,
  id: string,
  label: string,
  children: CommentTreeNode[],
): CommentTreeGroupNode {
  return {
    kind,
    id,
    label,
    children,
    descendantCommentIds: children.flatMap(collectDescendantCommentIds),
    actionableCommentIds: children.flatMap(collectActionableCommentIds),
  };
}

function createCommentNode(comment: PrComment): CommentTreeCommentNode {
  return {
    kind: COMMENT_TREE_NODE_KIND.COMMENT,
    id: `${COMMENT_NODE_ID_PREFIX}${comment.id}`,
    label: buildCommentLabel(comment),
    comment,
  };
}

function collectDescendantCommentIds(node: CommentTreeNode): string[] {
  if (node.kind === COMMENT_TREE_NODE_KIND.COMMENT) return [node.comment.id];
  return node.descendantCommentIds;
}

function collectActionableCommentIds(node: CommentTreeNode): string[] {
  if (node.kind === COMMENT_TREE_NODE_KIND.COMMENT) {
    return isRecommendedForRun(node.comment) ? [node.comment.id] : [];
  }
  return node.actionableCommentIds;
}

function buildCommentLabel(comment: PrComment): string {
  const flattened = comment.body.replace(WHITESPACE_RUN, SINGLE_SPACE).trim();
  const snippet = (() => {
    if (flattened.length === EMPTY_LENGTH) return EMPTY_BODY_LABEL;
    if (flattened.length <= COMMENT_LABEL_MAX_LENGTH) return flattened;
    return `${flattened.slice(TEXT_START_INDEX, COMMENT_LABEL_MAX_LENGTH)}${ELLIPSIS}`;
  })();
  return `${comment.author.login}${AUTHOR_LABEL_SEPARATOR}${snippet}`;
}

/** needsDecision first: it is the only state actively blocking progress. */
function sortNodes(
  nodes: CommentTreeNode[],
  runStateByCommentId: Readonly<Record<string, RunState>>,
): CommentTreeNode[] {
  return [...nodes].sort((first, second) => compareNodes(first, second, runStateByCommentId));
}

function compareNodes(
  first: CommentTreeNode,
  second: CommentTreeNode,
  runStateByCommentId: Readonly<Record<string, RunState>>,
): number {
  const isFirstBlocking = isBlocking(first, runStateByCommentId);
  const isSecondBlocking = isBlocking(second, runStateByCommentId);
  if (isFirstBlocking !== isSecondBlocking) return isFirstBlocking ? SORT_BEFORE : SORT_AFTER;

  const kindDelta = NODE_KIND_ORDER.indexOf(first.kind) - NODE_KIND_ORDER.indexOf(second.kind);
  if (kindDelta !== SORT_EQUAL) return kindDelta;

  if (
    first.kind === COMMENT_TREE_NODE_KIND.COMMENT &&
    second.kind === COMMENT_TREE_NODE_KIND.COMMENT
  ) {
    // Comments on one file read as a conversation, so they stay chronological.
    return compareLabels(first.comment.createdAt, second.comment.createdAt);
  }

  return compareLabels(first.label, second.label);
}

function isBlocking(
  node: CommentTreeNode,
  runStateByCommentId: Readonly<Record<string, RunState>>,
): boolean {
  return rollUpRunState(node, runStateByCommentId) === RUN_STATE.NEEDS_DECISION;
}

function compareLabels(first: string, second: string): number {
  return first.localeCompare(second);
}

function appendRows(
  nodes: readonly CommentTreeNode[],
  depth: number,
  options: FlattenCommentTreeOptions,
  rows: CommentTreeRow[],
): void {
  for (const node of nodes) {
    if (node.kind === COMMENT_TREE_NODE_KIND.COMMENT) {
      rows.push(createRow(node, depth, false, options));
      continue;
    }

    const hasChildren = node.children.length > EMPTY_LENGTH;
    const isExpanded = hasChildren && options.expandedNodeIds.has(node.id);
    rows.push(createRow(node, depth, isExpanded, options));
    if (isExpanded) appendRows(node.children, depth + DEPTH_STEP, options, rows);
  }
}

function createRow(
  node: CommentTreeNode,
  depth: number,
  isExpanded: boolean,
  options: FlattenCommentTreeOptions,
): CommentTreeRow {
  const isSelected =
    node.kind === COMMENT_TREE_NODE_KIND.COMMENT && node.comment.id === options.selectedCommentId;

  return {
    node,
    depth,
    hasChildren: hasRenderableChildren(node),
    isExpanded,
    isSelected,
    runState: rollUpRunState(node, options.runStateByCommentId),
    checkedState: resolveCheckedState(node, options.selectedCommentIds),
  };
}

function hasRenderableChildren(node: CommentTreeNode): boolean {
  if (node.kind === COMMENT_TREE_NODE_KIND.COMMENT) return false;
  return node.children.length > EMPTY_LENGTH;
}

function resolveCheckedState(
  node: CommentTreeNode,
  selectedCommentIds: ReadonlySet<string>,
): TreeRowCheckedState | undefined {
  const targets = selectionTargetsOf(node);
  if (targets.length === EMPTY_LENGTH) return undefined;

  const isFullySelected = targets.every((commentId) => selectedCommentIds.has(commentId));
  if (isFullySelected) return TREE_ROW_CHECKED_STATE.CHECKED;

  const isPartiallySelected = targets.some((commentId) => selectedCommentIds.has(commentId));
  if (isPartiallySelected) return TREE_ROW_CHECKED_STATE.INDETERMINATE;

  return TREE_ROW_CHECKED_STATE.UNCHECKED;
}

function appendDefaultExpanded(
  nodes: readonly CommentTreeNode[],
  depth: number,
  runStateByCommentId: Readonly<Record<string, RunState>>,
  expandedNodeIds: string[],
): void {
  for (const node of nodes) {
    if (node.kind === COMMENT_TREE_NODE_KIND.COMMENT) continue;
    if (node.children.length === EMPTY_LENGTH) continue;

    const states = collectRunStates(node.descendantCommentIds, runStateByCommentId);
    const shouldExpand = (() => {
      if (states.some(shouldAttractAttention)) return true;
      if (states.length > EMPTY_LENGTH && states.every(shouldSelfCollapse)) return false;
      // The fallback reveals paths rather than comment bodies, so a first look at a PR
      // is a file list with counts instead of every comment at once.
      if (node.kind === COMMENT_TREE_NODE_KIND.FILE) return false;
      return depth < DEFAULT_EXPANDED_DEPTH;
    })();
    if (!shouldExpand) continue;

    expandedNodeIds.push(node.id);
    appendDefaultExpanded(node.children, depth + DEPTH_STEP, runStateByCommentId, expandedNodeIds);
  }
}

function collectRunStates(
  commentIds: readonly string[],
  runStateByCommentId: Readonly<Record<string, RunState>>,
): RunState[] {
  return commentIds.map((commentId) => runStateByCommentId[commentId]).filter(isDefined);
}
