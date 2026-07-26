import {
  MODEL_LANE,
  isPoolSpending,
  type ModelCatalogEntry,
  type ModelLane,
  type TierModelMap,
} from '@shared/models';
import type { ModelTier } from '@shared/runState';
import { isDefined } from '@renderer/lib/guards';

export interface TierLaneResolution {
  tier: ModelTier;
  /** Null when the tier resolves the free lane's default at run time. */
  modelId: string | null;
  /** Null means undecided — the settings or the catalog have not been read yet. */
  lane: ModelLane | null;
}

export function resolveTierLane(
  tier: ModelTier,
  tierModelMap: TierModelMap | undefined,
  modelCatalog: readonly ModelCatalogEntry[] | undefined,
): TierLaneResolution {
  if (!isDefined(tierModelMap)) return { tier, modelId: null, lane: null };

  const { modelId } = tierModelMap[tier];
  // Null is "resolve the free lane's default at run time" rather than "unset", so it
  // needs no catalog lookup to be known free.
  if (modelId === null) return { tier, modelId: null, lane: MODEL_LANE.FREE };

  if (!isDefined(modelCatalog)) return { tier, modelId, lane: null };

  const entry = modelCatalog.find(
    (candidate) => candidate.id === modelId || candidate.aliases.includes(modelId),
  );
  // A pinned model the account's catalog does not list cannot be shown to be free,
  // and free is the expensive direction to guess wrong in.
  return { tier, modelId, lane: isDefined(entry) ? entry.lane : MODEL_LANE.POOL_SPENDING };
}

export function resolveTierLanes(
  tiers: readonly ModelTier[],
  tierModelMap: TierModelMap | undefined,
  modelCatalog: readonly ModelCatalogEntry[] | undefined,
): TierLaneResolution[] {
  return [...new Set(tiers)].map((tier) => resolveTierLane(tier, tierModelMap, modelCatalog));
}

export function isPoolSpendingResolution(resolution: TierLaneResolution): boolean {
  return isDefined(resolution.lane) && isPoolSpending(resolution.lane);
}

export function isUndecidedResolution(resolution: TierLaneResolution): boolean {
  return !isDefined(resolution.lane);
}
