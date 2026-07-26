import { useCallback, useMemo } from 'react';
import { prRefKey, type PrRef } from '@shared/discovery';
import type { RunState } from '@shared/runState';
import { useSessionStore } from '@renderer/stores/sessionStore';
import { defaultExpandedNodeIds, type CommentTreeNode } from './commentTreeModel';

export interface UseTreeExpansionOptions {
  prRef: PrRef;
  nodes: readonly CommentTreeNode[];
  runStateByCommentId: Readonly<Record<string, RunState>>;
}

interface UseTreeExpansionResult {
  expandedNodeIds: ReadonlySet<string>;
  onToggleExpanded: (nodeId: string) => void;
}

/**
 * Expansion is per-PR durable state, so it lives in the session store rather than in
 * component state: the shape you arranged has to survive both a PR switch and a restart.
 */
export function useTreeExpansion({
  prRef,
  nodes,
  runStateByCommentId,
}: UseTreeExpansionOptions): UseTreeExpansionResult {
  const persistedNodeIds = useSessionStore((state) => state.expandedNodeIdsByPr[prRefKey(prRef)]);
  const setExpandedNodeIds = useSessionStore((state) => state.setExpandedNodeIds);

  /**
   * No persisted entry means this PR has never been arranged, so the attention-based
   * default stands in. It is deliberately not written back on mount: seeding the store
   * from an effect would overwrite the arrangement hydration is about to deliver, and
   * would persist a shape the user never chose.
   */
  const expandedNodeIds = useMemo(
    () => new Set(persistedNodeIds ?? defaultExpandedNodeIds(nodes, runStateByCommentId)),
    [persistedNodeIds, nodes, runStateByCommentId],
  );

  const onToggleExpanded = useCallback(
    (nodeId: string) => {
      const nextNodeIds = new Set(expandedNodeIds);
      if (nextNodeIds.has(nodeId)) nextNodeIds.delete(nodeId);
      else nextNodeIds.add(nodeId);
      setExpandedNodeIds(prRef, [...nextNodeIds]);
    },
    [expandedNodeIds, prRef, setExpandedNodeIds],
  );

  return { expandedNodeIds, onToggleExpanded };
}
