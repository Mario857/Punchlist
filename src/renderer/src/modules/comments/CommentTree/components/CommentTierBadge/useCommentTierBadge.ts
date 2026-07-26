import { useCallback, useMemo } from 'react';
import type { PrComment } from '@shared/comments';
import type { ModelTier } from '@shared/runState';
import { classifyCommentTier } from '@shared/tier';
import type { BadgeTone } from '@renderer/components/Badge';
import { useSessionStore } from '@renderer/stores/sessionStore';
import {
  TIER_BADGE_TONE,
  TIER_LABEL,
  describeTierSignals,
  nextModelTier,
} from '@renderer/modules/comments/tierPresentation';

export interface UseCommentTierBadgeOptions {
  comment: PrComment;
}

interface UseCommentTierBadgeResult {
  label: string;
  tone: BadgeTone;
  /** The signals behind the tier, so the heuristic explains itself on hover. */
  title: string;
  ariaLabel: string;
  onCycleTierClick: () => void;
}

const PINNED_LABEL_SUFFIX = ' · pinned';

const SUGGESTED_TITLE_PREFIX = 'Suggested tier: ';
const PINNED_TITLE_PREFIX = 'Tier pinned to ';
const SUGGESTED_TITLE_INFIX = '. Punchlist suggested ';
const SIGNALS_TITLE_INFIX = ' — ';
const NEXT_TITLE_PREFIX = '. Click to use ';
const NEXT_TITLE_SUFFIX = ' instead.';
const TITLE_SENTENCE_END = '.';

const ARIA_LABEL_PREFIX = 'Model tier ';
const ARIA_LABEL_SUFFIX = '. Change it for this comment.';

/**
 * One click is the whole interaction: the badge walks the three tiers and, when the
 * next step lands back on the heuristic's own answer, drops the override instead of
 * pinning the same value — so "suggested" stays reachable without a second control.
 */
export function useCommentTierBadge({
  comment,
}: UseCommentTierBadgeOptions): UseCommentTierBadgeResult {
  const commentId = comment.id;
  const overrideTier = useSessionStore((state) => state.tierOverrideByCommentId[commentId]);
  const setTierOverride = useSessionStore((state) => state.setTierOverride);
  const clearTierOverride = useSessionStore((state) => state.clearTierOverride);

  const { tier: suggestedTier, signals } = useMemo(() => classifyCommentTier(comment), [comment]);

  const isOverridden = overrideTier !== undefined;
  const effectiveTier: ModelTier = isOverridden ? overrideTier : suggestedTier;
  const nextTier = nextModelTier(effectiveTier);

  const onCycleTierClick = useCallback(() => {
    if (nextTier === suggestedTier) {
      clearTierOverride(commentId);
      return;
    }
    setTierOverride(commentId, nextTier);
  }, [clearTierOverride, commentId, nextTier, setTierOverride, suggestedTier]);

  const effectiveLabel = TIER_LABEL[effectiveTier];
  const signalsDescription = describeTierSignals(signals);

  const title = (() => {
    const nextSentence = `${NEXT_TITLE_PREFIX}${TIER_LABEL[nextTier]}${NEXT_TITLE_SUFFIX}`;
    if (isOverridden) {
      return `${PINNED_TITLE_PREFIX}${effectiveLabel}${SUGGESTED_TITLE_INFIX}${TIER_LABEL[suggestedTier]}${SIGNALS_TITLE_INFIX}${signalsDescription}${TITLE_SENTENCE_END}${nextSentence}`;
    }
    return `${SUGGESTED_TITLE_PREFIX}${effectiveLabel}${SIGNALS_TITLE_INFIX}${signalsDescription}${nextSentence}`;
  })();

  return {
    label: isOverridden ? `${effectiveLabel}${PINNED_LABEL_SUFFIX}` : effectiveLabel,
    tone: TIER_BADGE_TONE[effectiveTier],
    title,
    ariaLabel: `${ARIA_LABEL_PREFIX}${effectiveLabel}${ARIA_LABEL_SUFFIX}`,
    onCycleTierClick,
  };
}
