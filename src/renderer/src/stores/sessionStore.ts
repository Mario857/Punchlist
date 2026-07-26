import { create } from 'zustand';
import type { CommentFilters } from '@shared/comments';
import { DEFAULT_COMMENT_FILTERS } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { prRefKey } from '@shared/discovery';
import { DEFAULT_SESSION_STATE, type SessionState } from '@shared/settings';

/**
 * Session state is Zustand rather than TanStack Query even though main owns the
 * file, because the write pattern is wrong for a request/response cache: expansion
 * toggles and selection changes fire on nearly every keystroke of navigation. This
 * is durable UI state, not server data — it is read once at boot and pushed back
 * debounced.
 */
interface SessionStore extends SessionState {
  /** Nothing should persist before hydration, or an empty store would overwrite the file. */
  isHydrated: boolean;
  hydrate: (state: SessionState) => void;
  setLastPr: (ref: PrRef | null) => void;
  setSelectedCommentIds: (commentIds: readonly string[]) => void;
  toggleCommentSelection: (commentId: string) => void;
  setExpandedNodeIds: (ref: PrRef, nodeIds: readonly string[]) => void;
  setFilters: (filters: CommentFilters) => void;
  markPrViewed: (ref: PrRef) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  ...DEFAULT_SESSION_STATE,
  isHydrated: false,

  hydrate: (state) => set({ ...state, isHydrated: true }),

  // Switching PR clears the selection: the ids belong to the PR that was open, and
  // carrying them across would select nothing while showing a non-zero count.
  setLastPr: (ref) => set({ lastPr: ref, selectedCommentIds: [] }),

  setSelectedCommentIds: (commentIds) => set({ selectedCommentIds: [...commentIds] }),

  toggleCommentSelection: (commentId) =>
    set((state) => {
      const isSelected = state.selectedCommentIds.includes(commentId);
      const selectedCommentIds = isSelected
        ? state.selectedCommentIds.filter((id) => id !== commentId)
        : [...state.selectedCommentIds, commentId];
      return { selectedCommentIds };
    }),

  setExpandedNodeIds: (ref, nodeIds) =>
    set((state) => ({
      expandedNodeIdsByPr: { ...state.expandedNodeIdsByPr, [prRefKey(ref)]: [...nodeIds] },
    })),

  setFilters: (filters) => set({ filters }),

  markPrViewed: (ref) =>
    set((state) => ({
      lastViewedAtByPr: {
        ...state.lastViewedAtByPr,
        [prRefKey(ref)]: new Date().toISOString(),
      },
    })),
}));

export const DEFAULT_FILTERS = DEFAULT_COMMENT_FILTERS;

/** The persisted subset, so the debounced writer never ships `isHydrated`. */
export function selectPersistableSession(state: SessionStore): SessionState {
  return {
    lastPr: state.lastPr,
    selectedCommentIds: state.selectedCommentIds,
    expandedNodeIdsByPr: state.expandedNodeIdsByPr,
    filters: state.filters,
    lastViewedAtByPr: state.lastViewedAtByPr,
  };
}
