import { z } from 'zod';
import { MODEL_TIER } from './runState';

/**
 * Cursor's pricing splits models in two, and the split is the whole reason the
 * router is a billing control rather than only a quality one: Auto and the
 * first-party models are unlimited on paid plans and do not draw down the included
 * dollar pool, while a manually pinned frontier model spends it at API rates.
 */
export const MODEL_LANE = {
  FREE: 'free',
  POOL_SPENDING: 'poolSpending',
} as const;

export type ModelLane = (typeof MODEL_LANE)[keyof typeof MODEL_LANE];

const modelParameterOptionSchema = z.object({
  value: z.string(),
  displayName: z.string().nullable().default(null),
});

const modelParameterSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable().default(null),
  values: z.array(modelParameterOptionSchema),
});

/**
 * One entry from `Cursor.models.list()`, normalized for the settings UI. The
 * catalog is read at run time and never hardcoded, because the SDK docs warn that
 * available models evolve per account.
 */
export const modelCatalogEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  aliases: z.array(z.string()).default([]),
  lane: z.enum(MODEL_LANE),
  /** Reasoning effort lives here, which is why it is discovered rather than assumed. */
  parameters: z.array(modelParameterSchema).default([]),
});

export type ModelParameterOption = z.infer<typeof modelParameterOptionSchema>;
export type ModelParameter = z.infer<typeof modelParameterSchema>;
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;

/** Null means "resolve the free lane's default at run time" rather than "unset". */
export const tierModelChoiceSchema = z.object({
  modelId: z.string().nullable().default(null),
  reasoningEffort: z.string().nullable().default(null),
});

/**
 * The tier-to-model mapping lives in settings rather than in code. Every tier
 * defaults into the free lane — including `complex` — so the tool's default
 * marginal cost is zero and any spend is something deliberately asked for.
 */
export const tierModelMapSchema = z.object({
  [MODEL_TIER.MECHANICAL]: tierModelChoiceSchema.default(() => tierModelChoiceSchema.parse({})),
  [MODEL_TIER.STANDARD]: tierModelChoiceSchema.default(() => tierModelChoiceSchema.parse({})),
  [MODEL_TIER.COMPLEX]: tierModelChoiceSchema.default(() => tierModelChoiceSchema.parse({})),
});

export type TierModelChoice = z.infer<typeof tierModelChoiceSchema>;
export type TierModelMap = z.infer<typeof tierModelMapSchema>;

export const DEFAULT_TIER_MODEL_MAP: TierModelMap = tierModelMapSchema.parse({});

export interface ResolvedModel {
  modelId: string;
  reasoningEffort: string | null;
  lane: ModelLane;
}

export function isPoolSpending(lane: ModelLane): boolean {
  return lane === MODEL_LANE.POOL_SPENDING;
}
