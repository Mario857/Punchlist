import { useEffect, type ChangeEvent } from 'react';
import { toErrorPayload } from '@shared/errors';
import {
  MODEL_LANE,
  isPoolSpending,
  type ModelCatalogEntry,
  type ModelLane,
  type ModelParameter,
  type TierModelChoice,
  type TierModelMap,
} from '@shared/models';
import { MODEL_TIER, type ModelTier } from '@shared/runState';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { BADGE_TONE, type BadgeTone } from '@renderer/components/Badge';
import { assertNever } from '@renderer/lib/assertNever';
import { isDefined } from '@renderer/lib/guards';
import { logError } from '@renderer/lib/logError';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { TIER_LABEL } from '@renderer/modules/comments/tierPresentation';
import {
  useQueryCursorKeyStatus,
  useQueryModelCatalog,
} from '@renderer/hooks/useQueryModelCatalog';
import {
  useExecuteUpdateSettings,
  useQuerySettings,
} from '@renderer/modules/settings/useQuerySettings';

/** A model id is never empty, so the empty string is a safe "nothing pinned" sentinel. */
const UNSET_SELECT_VALUE = '';

const TIER_ORDER: readonly ModelTier[] = [
  MODEL_TIER.MECHANICAL,
  MODEL_TIER.STANDARD,
  MODEL_TIER.COMPLEX,
];

const MODEL_SELECT_ID_PREFIX = 'settings-tier-model-';
const EFFORT_SELECT_ID_PREFIX = 'settings-tier-effort-';

const OPTION_GROUP_LABEL = {
  DEFAULT: 'Default',
  FREE: 'Unlimited on your plan',
  POOL_SPENDING: 'Spends your included pool',
  UNAVAILABLE: 'No longer offered by this account',
} as const;

const FREE_LANE_DEFAULT_OPTION_LABEL = 'Free-lane default — resolved at run time';
const MODEL_DEFAULT_EFFORT_OPTION_LABEL = "The model's own default";
const POOL_SPENDING_OPTION_SUFFIX = ' · spends your pool';
const UNAVAILABLE_OPTION_SUFFIX = ' · no longer offered';

const LANE_BADGE_LABEL = {
  FREE_LANE_DEFAULT: 'Free-lane default',
  UNLIMITED: 'Unlimited',
  POOL_SPENDING: 'Spends your pool',
  UNAVAILABLE: 'Unavailable',
} as const;

const POOL_SPENDING_WARNING =
  'This tier is pinned to a pool-spending model: it bills your included dollar pool at API rates and then continues as on-demand overage. Every other tier stays at zero marginal cost, so this one is spend you asked for.';

const UNAVAILABLE_MODEL_NOTICE_SUFFIX =
  ' is not in this account’s catalog any more. It is left pinned rather than swapped for something else behind your back — pick a replacement, or fall back to the free-lane default.';

const REASONING_EFFORT_FALLBACK_LABEL = 'Reasoning effort';

/**
 * The SDK names this parameter itself and the spelling varies per model, so the
 * effort control is discovered by matching a known set of ids against the chosen
 * model's own parameters. A model carrying none of them simply has no effort control.
 */
const REASONING_EFFORT_PARAMETER_IDS: readonly string[] = [
  'reasoningEffort',
  'reasoning_effort',
  'thinkingLevel',
  'effort',
];

const ALL_FREE_SUMMARY_LABEL = 'Every tier free';
const SINGLE_POOL_SPENDING_SUMMARY_LABEL = '1 tier spends your pool';
const POOL_SPENDING_SUMMARY_SUFFIX = ' tiers spend your pool';

const CURSOR_KEY_MISSING_TITLE = 'No Cursor API key is stored yet';
const CURSOR_KEY_MISSING_MESSAGE =
  'The catalog is read through the Cursor SDK, which needs a key. Airlock keeps CURSOR_API_KEY in the OS keychain and uses it inside the main process, so its value never reaches this screen. Until one is stored every tier resolves to its free-lane default at run time — which is the zero-cost behaviour these controls start from anyway.';

export interface TierModelOption {
  value: string;
  label: string;
}

export interface TierModelOptionGroup {
  label: string;
  options: TierModelOption[];
}

export interface TierReasoningEffortControl {
  selectId: string;
  label: string;
  value: string;
  options: TierModelOption[];
}

export interface TierModelRowModel {
  tier: ModelTier;
  tierLabel: string;
  tierDescription: string;
  modelSelectId: string;
  modelValue: string;
  modelOptionGroups: TierModelOptionGroup[];
  laneBadgeLabel: string;
  laneBadgeTone: BadgeTone;
  isLaneBadgeMuted: boolean;
  poolSpendingWarning: string | null;
  unavailableModelNotice: string | null;
  reasoningEffortControl: TierReasoningEffortControl | null;
  isFreeLaneResetVisible: boolean;
  isDisabled: boolean;
  onModelChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onReasoningEffortChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onFreeLaneResetClick: () => void;
}

/** The label comes from the comments module, so a tier is spelled once app-wide. */
function describeTier(tier: ModelTier): string {
  switch (tier) {
    case MODEL_TIER.MECHANICAL:
      return 'Typos, renames, single-line edits — work the router judged narrow by construction. This is where dialling reasoning effort down pays off.';
    case MODEL_TIER.STANDARD:
      return 'The middle of the distribution: an anchored comment with real but bounded scope, which is most of what a review produces.';
    case MODEL_TIER.COMPLEX:
      return 'Architecture, trade-offs, contested threads. It defaults to the free lane like the others — a frontier model is never reached for on your behalf.';
    default:
      return assertNever(tier);
  }
}

interface LanePresentation {
  badgeLabel: string;
  badgeTone: BadgeTone;
  isBadgeMuted: boolean;
  poolSpendingWarning: string | null;
}

function describeLane(lane: ModelLane): LanePresentation {
  switch (lane) {
    case MODEL_LANE.FREE:
      return {
        badgeLabel: LANE_BADGE_LABEL.UNLIMITED,
        badgeTone: BADGE_TONE.SUCCESS,
        isBadgeMuted: true,
        poolSpendingWarning: null,
      };
    case MODEL_LANE.POOL_SPENDING:
      // The one place a loud badge is earned: this selection costs money.
      return {
        badgeLabel: LANE_BADGE_LABEL.POOL_SPENDING,
        badgeTone: BADGE_TONE.DANGER,
        isBadgeMuted: false,
        poolSpendingWarning: POOL_SPENDING_WARNING,
      };
    default:
      return assertNever(lane);
  }
}

/** Aliases are matched too, because a persisted choice may have pinned one. */
function findCatalogEntry(
  catalog: readonly ModelCatalogEntry[],
  modelId: string | null,
): ModelCatalogEntry | null {
  if (!isDefined(modelId)) return null;
  return catalog.find((entry) => entry.id === modelId || entry.aliases.includes(modelId)) ?? null;
}

function findReasoningEffortParameter(entry: ModelCatalogEntry): ModelParameter | null {
  return (
    entry.parameters.find((parameter) => REASONING_EFFORT_PARAMETER_IDS.includes(parameter.id)) ??
    null
  );
}

function toModelOption(entry: ModelCatalogEntry): TierModelOption {
  const label = isPoolSpending(entry.lane)
    ? `${entry.displayName}${POOL_SPENDING_OPTION_SUFFIX}`
    : entry.displayName;
  return { value: entry.id, label };
}

function buildModelOptionGroups(
  catalog: readonly ModelCatalogEntry[],
  unavailableModelId: string | null,
): TierModelOptionGroup[] {
  const freeOptions = catalog.filter((entry) => !isPoolSpending(entry.lane)).map(toModelOption);
  const poolSpendingOptions = catalog
    .filter((entry) => isPoolSpending(entry.lane))
    .map(toModelOption);

  const groups: TierModelOptionGroup[] = [
    {
      label: OPTION_GROUP_LABEL.DEFAULT,
      options: [{ value: UNSET_SELECT_VALUE, label: FREE_LANE_DEFAULT_OPTION_LABEL }],
    },
  ];

  if (freeOptions.length > 0) {
    groups.push({ label: OPTION_GROUP_LABEL.FREE, options: freeOptions });
  }
  if (poolSpendingOptions.length > 0) {
    groups.push({ label: OPTION_GROUP_LABEL.POOL_SPENDING, options: poolSpendingOptions });
  }
  // A pinned model the account no longer offers stays selectable, so the select can
  // keep showing the truth instead of silently snapping to another model.
  if (isDefined(unavailableModelId)) {
    groups.push({
      label: OPTION_GROUP_LABEL.UNAVAILABLE,
      options: [
        {
          value: unavailableModelId,
          label: `${unavailableModelId}${UNAVAILABLE_OPTION_SUFFIX}`,
        },
      ],
    });
  }

  return groups;
}

function buildReasoningEffortControl(
  tier: ModelTier,
  entry: ModelCatalogEntry | null,
  reasoningEffort: string | null,
): TierReasoningEffortControl | null {
  if (entry === null) return null;
  const parameter = findReasoningEffortParameter(entry);
  if (parameter === null) return null;

  const options: TierModelOption[] = [
    { value: UNSET_SELECT_VALUE, label: MODEL_DEFAULT_EFFORT_OPTION_LABEL },
    ...parameter.values.map((option) => ({
      value: option.value,
      label: option.displayName ?? option.value,
    })),
  ];

  return {
    selectId: `${EFFORT_SELECT_ID_PREFIX}${tier}`,
    label: parameter.displayName ?? REASONING_EFFORT_FALLBACK_LABEL,
    value: reasoningEffort ?? UNSET_SELECT_VALUE,
    options,
  };
}

interface ModelRoutingProblem {
  message: string;
  remediation: string | null;
}

/** IpcError carries the kind and remediation across IPC; anything else has a message only. */
function toModelRoutingProblem(error: unknown): ModelRoutingProblem {
  if (isIpcError(error)) return { message: error.message, remediation: error.remediation };
  return { message: toErrorPayload(error).message, remediation: null };
}

interface UseTierModelMappingResult {
  tierRows: TierModelRowModel[];
  summaryBadgeLabel: string;
  summaryBadgeTone: BadgeTone;
  isSummaryBadgeMuted: boolean;
  isModelRoutingLoading: boolean;
  isCursorKeyMissing: boolean;
  cursorKeyMissingTitle: string;
  cursorKeyMissingMessage: string;
  modelRoutingErrorMessage: string | null;
  modelRoutingRemediation: string | null;
  settingsErrorMessage: string | null;
  isRefreshDisabled: boolean;
  onRefreshCatalogClick: () => void;
}

export function useTierModelMapping(): UseTierModelMappingResult {
  const { settings, isSettingsLoading, settingsError } = useQuerySettings();
  const { updateSettings, isUpdateSettingsPending } = useExecuteUpdateSettings();
  const { isCursorKeySet, isCursorKeyStatusLoading, cursorKeyStatusError } =
    useQueryCursorKeyStatus();
  // models.list() needs a stored key, so asking for the catalog without one would
  // only produce an error the user cannot act on from this card.
  const isCatalogEnabled = isCursorKeySet === true;
  const { modelCatalog, isModelCatalogLoading, modelCatalogError, refetchModelCatalog } =
    useQueryModelCatalog(isCatalogEnabled);

  useEffect(() => {
    if (!isDefined(settingsError)) return;
    logError(settingsError, 'useTierModelMapping.settings');
  }, [settingsError]);

  useEffect(() => {
    if (!isDefined(cursorKeyStatusError)) return;
    logError(cursorKeyStatusError, 'useTierModelMapping.cursorKeyStatus');
  }, [cursorKeyStatusError]);

  useEffect(() => {
    if (!isDefined(modelCatalogError)) return;
    logError(modelCatalogError, 'useTierModelMapping.modelCatalog');
  }, [modelCatalogError]);

  // While the queries are in flight there is no settings object, and the defaults are
  // exactly what main returns for a fresh install: every tier on the free lane.
  const tierModelMap = settings?.tierModelMap ?? DEFAULT_APP_SETTINGS.tierModelMap;
  const catalog = modelCatalog ?? [];
  const isDisabled = isSettingsLoading || isUpdateSettingsPending;

  const updateTierChoice = (tier: ModelTier, choice: TierModelChoice): void => {
    const nextTierModelMap: TierModelMap = { ...tierModelMap };
    nextTierModelMap[tier] = choice;
    updateSettings({ tierModelMap: nextTierModelMap });
  };

  const onModelChange = (tier: ModelTier, event: ChangeEvent<HTMLSelectElement>): void => {
    const selectedModelId = event.target.value;
    // Effort values are defined per model, so a value carried over from the previous
    // model would be meaningless: the choice resets to the new model's own default.
    updateTierChoice(tier, {
      modelId: selectedModelId === UNSET_SELECT_VALUE ? null : selectedModelId,
      reasoningEffort: null,
    });
  };

  const onReasoningEffortChange = (
    tier: ModelTier,
    event: ChangeEvent<HTMLSelectElement>,
  ): void => {
    const selectedEffort = event.target.value;
    updateTierChoice(tier, {
      modelId: tierModelMap[tier].modelId,
      reasoningEffort: selectedEffort === UNSET_SELECT_VALUE ? null : selectedEffort,
    });
  };

  const onFreeLaneResetClick = (tier: ModelTier): void => {
    updateTierChoice(tier, { modelId: null, reasoningEffort: null });
  };

  const tierRows = TIER_ORDER.map((tier): TierModelRowModel => {
    const choice = tierModelMap[tier];
    const entry = findCatalogEntry(catalog, choice.modelId);
    const isPinnedModelMissing = isDefined(choice.modelId) && entry === null;

    const lanePresentation = ((): LanePresentation => {
      if (!isDefined(choice.modelId)) {
        return {
          badgeLabel: LANE_BADGE_LABEL.FREE_LANE_DEFAULT,
          badgeTone: BADGE_TONE.NEUTRAL,
          isBadgeMuted: true,
          poolSpendingWarning: null,
        };
      }
      if (entry === null) {
        return {
          badgeLabel: LANE_BADGE_LABEL.UNAVAILABLE,
          badgeTone: BADGE_TONE.WARNING,
          isBadgeMuted: false,
          poolSpendingWarning: null,
        };
      }
      return describeLane(entry.lane);
    })();

    return {
      tier,
      tierLabel: TIER_LABEL[tier],
      tierDescription: describeTier(tier),
      modelSelectId: `${MODEL_SELECT_ID_PREFIX}${tier}`,
      modelValue: choice.modelId ?? UNSET_SELECT_VALUE,
      modelOptionGroups: buildModelOptionGroups(
        catalog,
        isPinnedModelMissing ? choice.modelId : null,
      ),
      laneBadgeLabel: lanePresentation.badgeLabel,
      laneBadgeTone: lanePresentation.badgeTone,
      isLaneBadgeMuted: lanePresentation.isBadgeMuted,
      poolSpendingWarning: lanePresentation.poolSpendingWarning,
      unavailableModelNotice: isPinnedModelMissing
        ? `${choice.modelId}${UNAVAILABLE_MODEL_NOTICE_SUFFIX}`
        : null,
      reasoningEffortControl: buildReasoningEffortControl(tier, entry, choice.reasoningEffort),
      isFreeLaneResetVisible: isDefined(choice.modelId),
      isDisabled,
      onModelChange: (event) => onModelChange(tier, event),
      onReasoningEffortChange: (event) => onReasoningEffortChange(tier, event),
      onFreeLaneResetClick: () => onFreeLaneResetClick(tier),
    };
  });

  const poolSpendingTierCount = tierRows.filter((row) => isDefined(row.poolSpendingWarning)).length;

  const summaryBadgeLabel = (() => {
    if (poolSpendingTierCount === 0) return ALL_FREE_SUMMARY_LABEL;
    if (poolSpendingTierCount === 1) return SINGLE_POOL_SPENDING_SUMMARY_LABEL;
    return `${poolSpendingTierCount}${POOL_SPENDING_SUMMARY_SUFFIX}`;
  })();

  const problem = ((): ModelRoutingProblem | null => {
    if (isDefined(cursorKeyStatusError)) return toModelRoutingProblem(cursorKeyStatusError);
    if (isDefined(modelCatalogError)) return toModelRoutingProblem(modelCatalogError);
    return null;
  })();

  return {
    tierRows,
    summaryBadgeLabel,
    summaryBadgeTone: poolSpendingTierCount === 0 ? BADGE_TONE.SUCCESS : BADGE_TONE.DANGER,
    isSummaryBadgeMuted: poolSpendingTierCount === 0,
    isModelRoutingLoading: isCursorKeyStatusLoading || isSettingsLoading || isModelCatalogLoading,
    isCursorKeyMissing: isCursorKeySet === false,
    cursorKeyMissingTitle: CURSOR_KEY_MISSING_TITLE,
    cursorKeyMissingMessage: CURSOR_KEY_MISSING_MESSAGE,
    modelRoutingErrorMessage: problem?.message ?? null,
    modelRoutingRemediation: problem?.remediation ?? null,
    settingsErrorMessage: isDefined(settingsError) ? toErrorPayload(settingsError).message : null,
    isRefreshDisabled: !isCatalogEnabled || isModelCatalogLoading,
    onRefreshCatalogClick: refetchModelCatalog,
  };
}
