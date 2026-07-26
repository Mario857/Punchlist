import { useCallback, useMemo } from 'react';
import type { ModelTier } from '@shared/runState';
import { useSessionStore } from '@renderer/stores/sessionStore';
import { MODEL_TIER_CYCLE, TIER_LABEL } from '@renderer/modules/comments/tierPresentation';

export interface UseBatchTierPickerOptions {
  selectedCommentIds: readonly string[];
}

export interface BatchTierOption {
  id: string;
  label: string;
  /** True when every selected comment already resolves through this option. */
  isActive: boolean;
  onSelectClick: () => void;
}

interface UseBatchTierPickerResult {
  options: BatchTierOption[];
  isDisabled: boolean;
}

/** Clearing every override hands the batch back to the heuristic. */
export const SUGGESTED_OPTION_ID = 'suggested';
const SUGGESTED_OPTION_LABEL = 'Suggested';

const EMPTY_COUNT = 0;

export function useBatchTierPicker({
  selectedCommentIds,
}: UseBatchTierPickerOptions): UseBatchTierPickerResult {
  const tierOverrideByCommentId = useSessionStore((state) => state.tierOverrideByCommentId);
  const setTierOverrideForComments = useSessionStore((state) => state.setTierOverrideForComments);
  const clearTierOverridesForComments = useSessionStore(
    (state) => state.clearTierOverridesForComments,
  );

  const isDisabled = selectedCommentIds.length === EMPTY_COUNT;

  // A mixed selection matches nothing, which is the honest answer: no single option
  // describes it, and pressing one is what makes it uniform.
  const activeOptionId = useMemo(() => {
    if (selectedCommentIds.length === EMPTY_COUNT) return null;
    const overrides = selectedCommentIds.map((commentId) => tierOverrideByCommentId[commentId]);
    const [first] = overrides;
    if (!overrides.every((tier) => tier === first)) return null;
    return first === undefined ? SUGGESTED_OPTION_ID : first;
  }, [selectedCommentIds, tierOverrideByCommentId]);

  const onSuggestedClick = useCallback(() => {
    clearTierOverridesForComments(selectedCommentIds);
  }, [clearTierOverridesForComments, selectedCommentIds]);

  const onTierClick = useCallback(
    (tier: ModelTier) => {
      setTierOverrideForComments(selectedCommentIds, tier);
    },
    [selectedCommentIds, setTierOverrideForComments],
  );

  const options = useMemo(() => {
    const suggestedOption: BatchTierOption = {
      id: SUGGESTED_OPTION_ID,
      label: SUGGESTED_OPTION_LABEL,
      isActive: activeOptionId === SUGGESTED_OPTION_ID,
      onSelectClick: onSuggestedClick,
    };
    const tierOptions = MODEL_TIER_CYCLE.map((tier) => ({
      id: tier,
      label: TIER_LABEL[tier],
      isActive: activeOptionId === tier,
      onSelectClick: () => onTierClick(tier),
    }));
    return [suggestedOption, ...tierOptions];
  }, [activeOptionId, onSuggestedClick, onTierClick]);

  return { options, isDisabled };
}
