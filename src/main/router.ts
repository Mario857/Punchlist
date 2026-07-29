// A static import from the CJS main process, not `import()`: @cursor/sdk ships a CJS
// build behind the `require` condition in its exports map, so the ESM-only carve-out in
// the no-dynamic-imports rule does not apply here.
import { Cursor } from '@cursor/sdk';
import type { ModelSelection, SDKModel } from '@cursor/sdk';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import {
  MODEL_LANE,
  modelCatalogEntrySchema,
  type ModelCatalogEntry,
  type ModelLane,
  type ModelParameter,
  type ResolvedModel,
  type TierModelChoice,
} from '@shared/models';
import { MODEL_TIER, type ModelTier } from '@shared/runState';
import { getCursorApiKey, getSettings } from './store';
import { recordBackgroundEvent } from './telemetry';

const MODEL_CATALOG_FETCH_EVENT = 'Model catalog fetch (Cursor API)';
const ROUTER_LOG_SCOPE = '[router]';

const MISSING_API_KEY_MESSAGE =
  'No Cursor API key is set, so the available models cannot be listed.';
const MISSING_API_KEY_REMEDIATION = 'Paste the key from cursor.com/settings into Settings.';
const NO_MODELS_MESSAGE = 'The Cursor account has no models available to the SDK.';
const NO_MODELS_REMEDIATION = 'Check the plan and API key at cursor.com/settings, then retry.';
const NO_FREE_LANE_MESSAGE =
  'No unlimited-lane model (Auto, Composer, Cursor Grok) is available on this account.';
const NO_FREE_LANE_REMEDIATION = 'Pin a model for each tier in Settings, then retry.';
const CONFIGURED_MODEL_REMEDIATION = 'Pick an available model for this tier in Settings.';

/**
 * Cursor's unlimited lane — Auto plus the first-party Composer and Cursor Grok models —
 * does not draw down the included dollar pool, so every tier defaults into it and a
 * frontier model is only ever an explicit opt-in.
 *
 * These are family prefixes matched against the live `Cursor.models.list()` output, never
 * a pinned id: the SDK docs warn that model lists evolve per account, so `composer-3`
 * must classify correctly without shipping an app update to name it. The order doubles as
 * the preference order for a tier that has no model configured.
 *
 * Bare `grok` is deliberately absent. It would also match xAI's own frontier Grok, and
 * mislabelling a pool-spending model as free is the one direction of this mistake that
 * costs the user money.
 */
const FREE_LANE_MODEL_IDENTIFIERS = ['auto', 'composer', 'cursor-grok', 'grok-code'] as const;

/** Family matching splits on this, so `composer` matches `composer-2.5` but not `composerx`. */
const MODEL_NAME_SEGMENT_SEPARATOR = '-';

/**
 * Reasoning effort is discovered from each model's own `parameters`, so this list only has
 * to recognise the parameter, never its values. Compared after normalization, which strips
 * separators — `reasoning_effort` and `reasoningEffort` both reduce to `reasoningeffort`.
 */
const EFFORT_PARAMETER_IDENTIFIERS = [
  'reasoningeffort',
  'reasoninglevel',
  'thinkinglevel',
  'reasoning',
  'thinking',
  'effort',
] as const;

const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]/g;

/**
 * Values a model does not declare are simply absent from its ladder; this only orders the
 * ones it does declare. Anything unrecognised sorts after the known values in the account's
 * declared order, because `Array#sort` is stable.
 */
const EFFORT_STRENGTH_ORDER: readonly string[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
];

const UNRANKED_EFFORT_RANK = EFFORT_STRENGTH_ORDER.length;
const NOT_ON_LADDER_INDEX = -1;
const EFFORT_ESCALATION_STEP = 1;

const LOWEST_LADDER_POSITION = 0;
const MIDPOINT_LADDER_POSITION = 0.5;
const HIGHEST_LADDER_POSITION = 1;

/**
 * A fractional position on whatever ladder the chosen model declares, rather than a hardcoded
 * effort string: dialling effort down on mechanical work is a lever that applies even inside
 * the unlimited lane, and a two-value model must still map all three tiers somewhere sensible.
 */
const TIER_LADDER_POSITION = {
  [MODEL_TIER.MECHANICAL]: LOWEST_LADDER_POSITION,
  [MODEL_TIER.STANDARD]: MIDPOINT_LADDER_POSITION,
  [MODEL_TIER.COMPLEX]: HIGHEST_LADDER_POSITION,
} as const satisfies Record<ModelTier, number>;

export interface ListModelCatalogOptions {
  /** The settings UI re-reads the account's models on demand; runs use the cached list. */
  shouldRefresh?: boolean;
}

/**
 * Crossing into the paid lane is always a deliberate action, so the model is named by the
 * caller — the router never picks a frontier model on its own.
 */
export interface FrontierModelRequest {
  modelId: string;
  /** null takes the tier's default position on the model's own effort ladder. */
  reasoningEffort: string | null;
}

/**
 * Listed once per session rather than per run: the call costs a round trip and an account's
 * models do not change in the middle of a batch.
 */
let cachedCatalog: ModelCatalogEntry[] | null = null;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeIdentifier(value: string): string {
  return normalizeName(value).replace(NON_ALPHANUMERIC_PATTERN, '');
}

function toModelNames(entry: ModelCatalogEntry): string[] {
  return [entry.id, ...entry.aliases].map(normalizeName);
}

function matchesModelFamily(name: string, identifier: string): boolean {
  return name === identifier || name.startsWith(`${identifier}${MODEL_NAME_SEGMENT_SEPARATOR}`);
}

function classifyLane(entry: ModelCatalogEntry): ModelLane {
  const names = toModelNames(entry);
  const isFreeLane = FREE_LANE_MODEL_IDENTIFIERS.some((identifier) =>
    names.some((name) => matchesModelFamily(name, identifier)),
  );
  return isFreeLane ? MODEL_LANE.FREE : MODEL_LANE.POOL_SPENDING;
}

/**
 * The SDK types the list, but the payload is still external data, so it goes through the
 * schema rather than being trusted. The provisional lane is the pool-spending one on purpose:
 * an entry whose classification is wrong then over-warns about spend instead of quietly
 * presenting a billable model as free.
 */
function toCatalogEntry(item: SDKModel): ModelCatalogEntry | null {
  const parsed = modelCatalogEntrySchema.safeParse({ ...item, lane: MODEL_LANE.POOL_SPENDING });
  if (!parsed.success) {
    console.warn(ROUTER_LOG_SCOPE, 'A listed model had an unexpected shape and was skipped.');
    return null;
  }

  return { ...parsed.data, lane: classifyLane(parsed.data) };
}

async function fetchModelCatalog(): Promise<ModelCatalogEntry[]> {
  recordBackgroundEvent(MODEL_CATALOG_FETCH_EVENT);
  const apiKey = getCursorApiKey();
  if (apiKey === null) {
    throw new AppError(
      APP_ERROR_KIND.CURSOR_KEY_MISSING,
      MISSING_API_KEY_MESSAGE,
      MISSING_API_KEY_REMEDIATION,
    );
  }

  // The key is handed to the SDK here and nowhere else: it is never logged, never returned,
  // and never part of an error message this module raises.
  const listed = await Cursor.models.list({ apiKey });
  const entries = listed
    .map(toCatalogEntry)
    .filter((entry): entry is ModelCatalogEntry => entry !== null);

  if (entries.length === 0) {
    throw new AppError(APP_ERROR_KIND.AGENT_START_FAILED, NO_MODELS_MESSAGE, NO_MODELS_REMEDIATION);
  }

  return entries;
}

export async function listModelCatalog(
  options: ListModelCatalogOptions = {},
): Promise<ModelCatalogEntry[]> {
  if (cachedCatalog !== null && options.shouldRefresh !== true) return cachedCatalog;

  const catalog = await fetchModelCatalog();
  cachedCatalog = catalog;
  return catalog;
}

function findEntryByName(
  catalog: readonly ModelCatalogEntry[],
  modelId: string,
): ModelCatalogEntry | null {
  const wanted = normalizeName(modelId);
  return catalog.find((entry) => toModelNames(entry).includes(wanted)) ?? null;
}

function findFreeLaneEntry(catalog: readonly ModelCatalogEntry[]): ModelCatalogEntry | null {
  for (const identifier of FREE_LANE_MODEL_IDENTIFIERS) {
    const match = catalog.find(
      (entry) =>
        entry.lane === MODEL_LANE.FREE &&
        toModelNames(entry).some((name) => matchesModelFamily(name, identifier)),
    );
    if (match !== undefined) return match;
  }

  return null;
}

function requireEntry(catalog: readonly ModelCatalogEntry[], modelId: string): ModelCatalogEntry {
  const entry = findEntryByName(catalog, modelId);
  if (entry === null) {
    // A configured model that has disappeared from the account must not silently resolve to
    // a different one — a substitution could be a different lane, and so a different bill.
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `The configured model "${modelId}" is no longer available on this Cursor account.`,
      CONFIGURED_MODEL_REMEDIATION,
    );
  }

  return entry;
}

function findEffortParameter(entry: ModelCatalogEntry): ModelParameter | null {
  const parameter = entry.parameters.find((candidate) =>
    EFFORT_PARAMETER_IDENTIFIERS.some(
      (identifier) => normalizeIdentifier(candidate.id) === identifier,
    ),
  );
  return parameter ?? null;
}

function rankEffort(value: string): number {
  const rank = EFFORT_STRENGTH_ORDER.indexOf(normalizeName(value));
  return rank === NOT_ON_LADDER_INDEX ? UNRANKED_EFFORT_RANK : rank;
}

/** The model's own declared values, weakest first. */
function toEffortLadder(parameter: ModelParameter): string[] {
  return parameter.values
    .map((option) => option.value)
    .sort((left, right) => rankEffort(left) - rankEffort(right));
}

function toTierEffort(ladder: readonly string[], tier: ModelTier): string | null {
  if (ladder.length === 0) return null;
  const strongestIndex = ladder.length - EFFORT_ESCALATION_STEP;
  return ladder[Math.round(TIER_LADDER_POSITION[tier] * strongestIndex)];
}

/**
 * A requested effort is validated against the model's declared values rather than assumed:
 * settings can outlive the parameter definition that produced them. A model that declares no
 * effort parameter at all is not an error — it just runs at its own default.
 */
function resolveEffort(
  entry: ModelCatalogEntry,
  requestedEffort: string | null,
  tier: ModelTier,
): string | null {
  const parameter = findEffortParameter(entry);
  if (parameter === null) {
    if (requestedEffort !== null) {
      console.warn(
        ROUTER_LOG_SCOPE,
        `Model ${entry.id} declares no reasoning-effort parameter; the request is ignored.`,
      );
    }
    return null;
  }

  const ladder = toEffortLadder(parameter);
  if (requestedEffort === null) return toTierEffort(ladder, tier);

  // Matched by normalized name, answered with the declared value: the catalog's casing
  // is what the SDK expects back, and a setting saved as "high" must keep matching a
  // catalog that declares "High". Exact comparison here is what made Opus refuse an
  // effort it genuinely offers.
  const declaredEffort = ladder.find(
    (value) => normalizeName(value) === normalizeName(requestedEffort),
  );
  if (declaredEffort !== undefined) return declaredEffort;

  // A genuinely absent value must not make the model unusable: efforts are per-model
  // value sets, and one configured against a different model degrades to this model's
  // own rung for the tier rather than refusing to run at all.
  console.warn(
    ROUTER_LOG_SCOPE,
    `Model ${entry.id} does not offer the configured reasoning effort "${requestedEffort}"; using the tier default.`,
  );
  return toTierEffort(ladder, tier);
}

interface TierEntry {
  entry: ModelCatalogEntry;
  choice: TierModelChoice;
}

async function resolveTierEntry(tier: ModelTier): Promise<TierEntry> {
  const catalog = await listModelCatalog();
  const choice = getSettings().tierModelMap[tier];
  if (choice.modelId !== null) return { entry: requireEntry(catalog, choice.modelId), choice };

  const freeLane = findFreeLaneEntry(catalog);
  if (freeLane === null) {
    // Falling back to the first listed model would spend the included pool without being
    // asked, which is the one thing the default path must never do.
    throw new AppError(
      APP_ERROR_KIND.AGENT_START_FAILED,
      NO_FREE_LANE_MESSAGE,
      NO_FREE_LANE_REMEDIATION,
    );
  }

  return { entry: freeLane, choice };
}

function toResolvedModel(
  entry: ModelCatalogEntry,
  requestedEffort: string | null,
  tier: ModelTier,
): ResolvedModel {
  return {
    modelId: entry.id,
    reasoningEffort: resolveEffort(entry, requestedEffort, tier),
    lane: entry.lane,
  };
}

export async function resolveTierModel(tier: ModelTier): Promise<ResolvedModel> {
  const { entry, choice } = await resolveTierEntry(tier);
  return toResolvedModel(entry, choice.reasoningEffort, tier);
}

/**
 * The next stronger configuration for a tier, or null when there is nothing left to raise.
 *
 * Escalation keeps the tier's own model and only walks its effort ladder up one step, so it
 * can never cross into the pool-spending lane: silently reaching for a frontier model would
 * contradict frontier being an explicit opt-in, and would bill the user for a retry they
 * only asked to be "stronger".
 */
export async function resolveEscalatedModel(
  tier: ModelTier,
  currentEffort: string | null,
): Promise<ResolvedModel | null> {
  const { entry, choice } = await resolveTierEntry(tier);
  const parameter = findEffortParameter(entry);
  if (parameter === null) return null;

  const ladder = toEffortLadder(parameter);
  const startingEffort = currentEffort ?? resolveEffort(entry, choice.reasoningEffort, tier);
  // An effort that is not on the ladder — a stale value, or a model that changed its
  // parameters between runs — escalates from the bottom rather than failing the retry.
  const startingIndex =
    startingEffort === null ? NOT_ON_LADDER_INDEX : ladder.indexOf(startingEffort);
  const nextIndex = startingIndex + EFFORT_ESCALATION_STEP;
  if (nextIndex >= ladder.length) return null;

  return { modelId: entry.id, reasoningEffort: ladder[nextIndex], lane: entry.lane };
}

/**
 * The deliberate lane crossing behind the manual "retry with a frontier model" action. The
 * returned `lane` reports what the requested model actually costs, so callers can label the
 * run as pool-spending rather than inferring it from which function they called.
 */
export async function resolveFrontierModel(
  tier: ModelTier,
  request: FrontierModelRequest,
): Promise<ResolvedModel> {
  const catalog = await listModelCatalog();
  return toResolvedModel(requireEntry(catalog, request.modelId), request.reasoningEffort, tier);
}

/**
 * The parameter's id is model-specific and was discovered when the model resolved, so it is
 * read back from the session cache — which is warm by construction, since a `ResolvedModel`
 * can only have come from a catalog lookup above.
 */
export function toModelSelection(model: ResolvedModel): ModelSelection {
  if (model.reasoningEffort === null) return { id: model.modelId };

  const entry = cachedCatalog?.find((candidate) => candidate.id === model.modelId);
  const parameter = entry === undefined ? null : findEffortParameter(entry);
  if (parameter === null) return { id: model.modelId };

  return { id: model.modelId, params: [{ id: parameter.id, value: model.reasoningEffort }] };
}
