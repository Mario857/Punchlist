import { MODEL_TIER, type ModelTier } from '@shared/runState';
import { TIER_SIGNAL, type TierSignal, type TierSignalMatch } from '@shared/tier';
import { BADGE_TONE, type BadgeTone } from '@renderer/components/Badge';

/**
 * How a tier reads on screen, owned by the comments module because the tier is a
 * property of a comment before any run exists. The runs and review modules import
 * it so a tier never spells itself differently in the queue than on the row.
 */
export const TIER_LABEL: Record<ModelTier, string> = {
  [MODEL_TIER.MECHANICAL]: 'Mechanical',
  [MODEL_TIER.STANDARD]: 'Standard',
  [MODEL_TIER.COMPLEX]: 'Complex',
};

/**
 * Tones separate the three tiers without competing with `StateBadge`: every tier
 * badge renders muted, so this is a hue difference inside the weakest weight the
 * badge system has.
 */
export const TIER_BADGE_TONE: Record<ModelTier, BadgeTone> = {
  [MODEL_TIER.MECHANICAL]: BADGE_TONE.NEUTRAL,
  [MODEL_TIER.STANDARD]: BADGE_TONE.INFO,
  [MODEL_TIER.COMPLEX]: BADGE_TONE.ACCENT,
};

/** Cheapest first, so one click walks the tier up rather than around. */
export const MODEL_TIER_CYCLE: readonly ModelTier[] = [
  MODEL_TIER.MECHANICAL,
  MODEL_TIER.STANDARD,
  MODEL_TIER.COMPLEX,
];

const TIER_CYCLE_STEP = 1;

export function nextModelTier(tier: ModelTier): ModelTier {
  const index = MODEL_TIER_CYCLE.indexOf(tier);
  return MODEL_TIER_CYCLE[(index + TIER_CYCLE_STEP) % MODEL_TIER_CYCLE.length];
}

/**
 * A `Record` rather than a switch: a signal added to `src/shared/tier.ts` without a
 * phrase here is a compile error, which is the only thing that keeps an unexplained
 * signal from reaching the tooltip.
 */
const TIER_SIGNAL_PHRASE: Record<TierSignal, string> = {
  [TIER_SIGNAL.ANCHORED_SINGLE_LINE]: 'anchored to one line',
  [TIER_SIGNAL.UNANCHORED]: 'nothing to anchor to',
  [TIER_SIGNAL.SMALL_HUNK]: 'small hunk',
  [TIER_SIGNAL.LARGE_HUNK]: 'large hunk',
  [TIER_SIGNAL.SHORT_BODY]: 'short comment',
  [TIER_SIGNAL.LONG_BODY]: 'long comment',
  [TIER_SIGNAL.MECHANICAL_VERB]: 'opens with a mechanical verb',
  [TIER_SIGNAL.DESIGN_VOCABULARY]: 'design vocabulary',
  [TIER_SIGNAL.DEEP_THREAD]: 'long reply thread',
};

const SIGNAL_SEPARATOR = '; ';
const SIGNAL_DETAIL_OPEN = ' (';
const SIGNAL_DETAIL_CLOSE = ')';
const NO_SIGNALS_LABEL = 'nothing in the comment pointed either way';

const EMPTY_LENGTH = 0;

/**
 * `detail` is evidence rather than prose — the matched keyword or a measured count —
 * so the wording is composed here, which is where a phrasing change belongs.
 */
export function describeTierSignals(signals: readonly TierSignalMatch[]): string {
  if (signals.length === EMPTY_LENGTH) return NO_SIGNALS_LABEL;
  return signals
    .map(
      (match) =>
        `${TIER_SIGNAL_PHRASE[match.signal]}${SIGNAL_DETAIL_OPEN}${match.detail}${SIGNAL_DETAIL_CLOSE}`,
    )
    .join(SIGNAL_SEPARATOR);
}
