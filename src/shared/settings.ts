import { z } from 'zod';
import { commentFiltersSchema } from './comments';
import { prRefSchema } from './discovery';
import { automationSettingsSchema } from './automation';
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
  /** Off by default; see automation.ts for why an empty allowlist triggers nothing. */
  automation: automationSettingsSchema.default(() => automationSettingsSchema.parse({})),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = appSettingsSchema.parse({});

/**
 * Pane widths in CSS pixels. Persisted rather than fixed because how much room the
 * diff needs is a judgement about the monitor in front of you: the same width that is
 * generous on a laptop leaves a side-by-side patch unreadable on a wide display.
 */
export const LEFT_PANE_WIDTH = { MIN: 220, DEFAULT: 320, MAX: 560 } as const;
export const RIGHT_PANE_WIDTH = { MIN: 360, DEFAULT: 560, MAX: 1200 } as const;

/**
 * `.catch` rather than a bare default: a width persisted by an older build, or one
 * saved on a monitor that is no longer attached, degrades to the default instead of
 * failing the whole session parse and losing the rest of the restored state.
 */
const paneWidthsSchema = z.object({
  left: z.number().min(LEFT_PANE_WIDTH.MIN).max(LEFT_PANE_WIDTH.MAX).catch(LEFT_PANE_WIDTH.DEFAULT),
  right: z
    .number()
    .min(RIGHT_PANE_WIDTH.MIN)
    .max(RIGHT_PANE_WIDTH.MAX)
    .catch(RIGHT_PANE_WIDTH.DEFAULT),
});

export type PaneWidths = z.infer<typeof paneWidthsSchema>;

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
  /**
   * Where a landing would go, per PR. Persisted because it is a decision about a
   * specific PR rather than a global preference, and re-typing it after every restart
   * would invite typing it wrong.
   */
  targetBranchByPr: z.record(z.string(), z.string()).default({}),
  paneWidths: paneWidthsSchema.default(() => paneWidthsSchema.parse({})),
  /**
   * Closed by default. The batch actions and the sandbox summary are accelerators for
   * work the panes already do one run at a time, and leaving them open costs a third
   * of the window in explanatory prose before the first comment is visible.
   */
  isRunControlsExpanded: z.boolean().default(false),
});

export type SessionState = z.infer<typeof sessionStateSchema>;

export const DEFAULT_SESSION_STATE: SessionState = sessionStateSchema.parse({});
