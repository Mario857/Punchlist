import { z } from 'zod';
import { commentFiltersSchema } from './comments';
import { prRefSchema } from './discovery';
import { tierModelMapSchema } from './models';

/** The concurrency cap bounds how many worktrees and agents exist at once. */
export const DEFAULT_CONCURRENCY_CAP = 4;
export const MIN_CONCURRENCY_CAP = 1;
export const MAX_CONCURRENCY_CAP = 12;

/**
 * Every field defaults, so a settings object persisted by an older version of the
 * app widens to the current shape rather than failing to parse — the persisted
 * store is one of the three mandated Zod boundaries.
 */
export const appSettingsSchema = z.object({
  /** Scanned for directories containing .git to populate the repo registry. */
  repoScanRoot: z.string().nullable().default(null),
  concurrencyCap: z
    .number()
    .int()
    .min(MIN_CONCURRENCY_CAP)
    .max(MAX_CONCURRENCY_CAP)
    .default(DEFAULT_CONCURRENCY_CAP),
  /** Retains terminal-state worktrees so you can inspect what an agent did. */
  shouldRetainWorktrees: z.boolean().default(false),
  /**
   * Configurable rather than hardcoded, because the SDK's model list evolves per
   * account. Defaults resolve to the free lane at run time.
   */
  tierModelMap: tierModelMapSchema.default(() => tierModelMapSchema.parse({})),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = appSettingsSchema.parse({});

/**
 * Reopening the app restores the last PR, the selection, and the tree's expansion
 * state, so a restart is not a reset.
 */
export const sessionStateSchema = z.object({
  lastPr: prRefSchema.nullable().default(null),
  selectedCommentIds: z.array(z.string()).default([]),
  /** Keyed by prRefKey, because expansion is remembered per PR. */
  expandedNodeIdsByPr: z.record(z.string(), z.array(z.string())).default({}),
  filters: commentFiltersSchema.default(() => commentFiltersSchema.parse({})),
  /** Backs the new-since-last-viewed marker. Keyed by prRefKey. */
  lastViewedAtByPr: z.record(z.string(), z.string()).default({}),
});

export type SessionState = z.infer<typeof sessionStateSchema>;

export const DEFAULT_SESSION_STATE: SessionState = sessionStateSchema.parse({});
