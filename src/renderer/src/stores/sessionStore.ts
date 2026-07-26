import { create } from 'zustand';
import type { CommentFilters } from '@shared/comments';
import { DEFAULT_COMMENT_FILTERS } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { prRefKey } from '@shared/discovery';
import type { ModelTier } from '@shared/runState';
import {
  DEFAULT_SESSION_STATE,
  type PaneSizes,
  type PaneVisibility,
  type RunPanePlacement,
  type SessionState,
} from '@shared/settings';

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
  /**
   * The tier heuristic will misfire, so every comment's tier is overridable before
   * anything runs. Overrides live beside `selectedCommentIds` because a batch start
   * reads exactly that pair, and deliberately *outside* `SessionState`: they describe
   * work that has not started yet, so they last the session rather than the install.
   * Being absent from `SessionState` is what keeps `selectPersistableSession` from
   * ever shipping them to the file on disk.
   */
  tierOverrideByCommentId: Readonly<Record<string, ModelTier>>;
  hydrate: (state: SessionState) => void;
  setLastPr: (ref: PrRef | null) => void;
  setSelectedCommentIds: (commentIds: readonly string[]) => void;
  toggleCommentSelection: (commentId: string) => void;
  setExpandedNodeIds: (ref: PrRef, nodeIds: readonly string[]) => void;
  setFilters: (filters: CommentFilters) => void;
  markPrViewed: (ref: PrRef) => void;
  setTargetBranch: (ref: PrRef, targetBranch: string) => void;
  /** Partial because a drag moves one edge, and the other pane keeps what it had. */
  setPaneSizes: (patch: Partial<PaneSizes>) => void;
  setIsRunControlsExpanded: (isExpanded: boolean) => void;
  setRunPanePlacement: (placement: RunPanePlacement) => void;
  /** Partial because a toggle moves one pane and the others keep what they had. */
  setPaneVisibility: (patch: Partial<PaneVisibility>) => void;
  setIsRunPaneVerbose: (isVerbose: boolean) => void;
  setSectionOpen: (sectionId: string, isOpen: boolean) => void;
  setTierOverride: (commentId: string, tier: ModelTier) => void;
  /** Drops the override so the comment falls back to the heuristic's answer. */
  clearTierOverride: (commentId: string) => void;
  /** One tier applied to a whole selection, which is the batch-level override. */
  setTierOverrideForComments: (commentIds: readonly string[], tier: ModelTier) => void;
  clearTierOverridesForComments: (commentIds: readonly string[]) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  ...DEFAULT_SESSION_STATE,
  isHydrated: false,
  tierOverrideByCommentId: {},

  hydrate: (state) => set({ ...state, isHydrated: true }),

  // Switching PR clears the selection: the ids belong to the PR that was open, and
  // carrying them across would select nothing while showing a non-zero count. Tier
  // overrides are keyed by those same ids, so they go with them.
  setLastPr: (ref) => set({ lastPr: ref, selectedCommentIds: [], tierOverrideByCommentId: {} }),

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

  setTargetBranch: (ref, targetBranch) =>
    set((state) => ({
      targetBranchByPr: { ...state.targetBranchByPr, [prRefKey(ref)]: targetBranch },
    })),

  setPaneSizes: (patch) => set((state) => ({ paneSizes: { ...state.paneSizes, ...patch } })),

  setIsRunControlsExpanded: (isRunControlsExpanded) => set({ isRunControlsExpanded }),

  setRunPanePlacement: (runPanePlacement) => set({ runPanePlacement }),

  setPaneVisibility: (patch) =>
    set((state) => ({ paneVisibility: { ...state.paneVisibility, ...patch } })),

  setIsRunPaneVerbose: (isRunPaneVerbose) => set({ isRunPaneVerbose }),

  setSectionOpen: (sectionId, isOpen) =>
    set((state) => ({ sectionOpenById: { ...state.sectionOpenById, [sectionId]: isOpen } })),

  markPrViewed: (ref) =>
    set((state) => ({
      lastViewedAtByPr: {
        ...state.lastViewedAtByPr,
        [prRefKey(ref)]: new Date().toISOString(),
      },
    })),

  setTierOverride: (commentId, tier) =>
    set((state) => ({
      tierOverrideByCommentId: { ...state.tierOverrideByCommentId, [commentId]: tier },
    })),

  clearTierOverride: (commentId) =>
    set((state) => {
      const tierOverrideByCommentId: Record<string, ModelTier> = {
        ...state.tierOverrideByCommentId,
      };
      delete tierOverrideByCommentId[commentId];
      return { tierOverrideByCommentId };
    }),

  setTierOverrideForComments: (commentIds, tier) =>
    set((state) => {
      const tierOverrideByCommentId: Record<string, ModelTier> = {
        ...state.tierOverrideByCommentId,
      };
      for (const commentId of commentIds) tierOverrideByCommentId[commentId] = tier;
      return { tierOverrideByCommentId };
    }),

  clearTierOverridesForComments: (commentIds) =>
    set((state) => {
      const tierOverrideByCommentId: Record<string, ModelTier> = {
        ...state.tierOverrideByCommentId,
      };
      for (const commentId of commentIds) delete tierOverrideByCommentId[commentId];
      return { tierOverrideByCommentId };
    }),
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
    targetBranchByPr: state.targetBranchByPr,
    paneSizes: state.paneSizes,
    runPanePlacement: state.runPanePlacement,
    paneVisibility: state.paneVisibility,
    isRunPaneVerbose: state.isRunPaneVerbose,
    sectionOpenById: state.sectionOpenById,
    isRunControlsExpanded: state.isRunControlsExpanded,
  };
}
