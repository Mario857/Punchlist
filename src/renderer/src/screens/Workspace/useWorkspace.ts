import { useEffect, useState } from 'react';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import type { RunState } from '@shared/runState';
import { useQueryPrComments } from '@renderer/modules/comments/useQueryPrComments';
import { useQueryRuns } from '@renderer/modules/runs/useQueryRuns';
import { useRunStateByCommentId } from '@renderer/stores/runStore';
import { useSessionStore } from '@renderer/stores/sessionStore';

/** A stable identity, so an absent result does not remount the tree every render. */
const EMPTY_COMMENTS: PrComment[] = [];

interface UseWorkspaceResult {
  selectedPr: PrRef | null;
  isPickerOpen: boolean;
  comments: PrComment[];
  selectedComment: PrComment | null;
  selectedCommentId: string | null;
  isPrCommentsLoading: boolean;
  isPrCommentsFetching: boolean;
  prCommentsError: unknown;
  /** Drives the tree's run-state badges and its attention-budget expansion. */
  runStateByCommentId: Readonly<Record<string, RunState>>;
  onSelectPr: (ref: PrRef) => void;
  onSelectComment: (commentId: string) => void;
  onTogglePicker: () => void;
  onRefreshComments: () => void;
}

/**
 * The Workspace owns orchestration: it lifts the selected comment so the tree and
 * the detail pane stay decoupled, and it fetches the comment set once so both panes
 * read the same data.
 */
export function useWorkspace(): UseWorkspaceResult {
  const selectedPr = useSessionStore((state) => state.lastPr);
  const setLastPr = useSessionStore((state) => state.setLastPr);
  const markPrViewed = useSessionStore((state) => state.markPrViewed);

  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const {
    prComments,
    isPrCommentsLoading,
    isPrCommentsFetching,
    prCommentsError,
    refetchPrComments,
  } = useQueryPrComments(selectedPr);

  // Hydrates the run store from persisted state, so a restart does not show an
  // empty queue for runs that are still alive in main.
  useQueryRuns(selectedPr);
  const runStateByCommentId = useRunStateByCommentId();

  const comments = prComments ?? EMPTY_COMMENTS;
  const selectedComment = comments.find((comment) => comment.id === selectedCommentId) ?? null;

  // Stamped once the comments actually arrive, so the new-since-last-viewed marker
  // reflects what you could have seen rather than merely which PR was open.
  useEffect(() => {
    if (selectedPr === null || prComments === undefined) return;
    markPrViewed(selectedPr);
  }, [selectedPr, prComments, markPrViewed]);

  return {
    selectedPr,
    isPickerOpen,
    comments,
    selectedComment,
    selectedCommentId,
    isPrCommentsLoading,
    isPrCommentsFetching,
    prCommentsError,
    runStateByCommentId,
    onSelectPr: (ref) => {
      setLastPr(ref);
      setSelectedCommentId(null);
      setIsPickerOpen(false);
    },
    onSelectComment: setSelectedCommentId,
    onTogglePicker: () => setIsPickerOpen((isOpen) => !isOpen),
    onRefreshComments: refetchPrComments,
  };
}
