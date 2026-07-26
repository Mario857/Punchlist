import { z } from 'zod';

/**
 * The watcher polls because webhooks need a public endpoint a local desktop app does
 * not have. Sixty seconds sits comfortably inside GraphQL rate limits given the
 * updatedAt short-circuit in front of the comment queries.
 */
export const DEFAULT_WATCHER_POLL_INTERVAL_MS = 60_000;

/** A runaway guard, not a throughput setting: automation runs while you are away. */
export const DEFAULT_MAX_AUTO_RUNS_PER_HOUR = 6;

/**
 * Off by default, and safe because of where it stops: an auto-triggered cycle runs
 * entirely in the sandbox and parks at `ready`. It automates the slow work, never a
 * decision — the landing gate is untouched.
 */
export const automationSettingsSchema = z.object({
  isEnabled: z.boolean().default(false),
  /**
   * Only comments from these authors trigger a run. An empty list means nothing
   * triggers, which is why enabling automation without naming anyone does nothing
   * rather than reacting to everyone.
   */
  authorAllowlist: z.array(z.string()).default([]),
  maxAutoRunsPerHour: z.number().int().positive().default(DEFAULT_MAX_AUTO_RUNS_PER_HOUR),
  pollIntervalMs: z.number().int().positive().default(DEFAULT_WATCHER_POLL_INTERVAL_MS),
});

export type AutomationSettings = z.infer<typeof automationSettingsSchema>;

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = automationSettingsSchema.parse({});

/**
 * What the watcher remembers between polls, keyed by prRefKey. Persisted so a restart
 * does not re-trigger history — every comment on the PR would otherwise look new.
 */
export const watcherStateSchema = z.object({
  /** Compared before the comment queries run, which is what keeps polling cheap. */
  lastUpdatedAtByPr: z.record(z.string(), z.string()).default({}),
  lastSeenCommentIdsByPr: z.record(z.string(), z.array(z.string())).default({}),
  /**
   * Existing worktrees are based on the old head, so when it moves their runs are
   * marked stale rather than silently yielding patches against outdated code.
   */
  lastHeadShaByPr: z.record(z.string(), z.string()).default({}),
  /** Timestamps of recent auto-triggered runs, for the per-hour ceiling. */
  autoRunStartedAt: z.array(z.string()).default([]),
});

export type WatcherState = z.infer<typeof watcherStateSchema>;

export const DEFAULT_WATCHER_STATE: WatcherState = watcherStateSchema.parse({});

/** The cheap first stage of the poll: no comment query runs unless this moved. */
export interface PrStatus {
  updatedAt: string;
  headSha: string;
  /**
   * The branch this PR is open against. `gh search prs --json` cannot return it, so
   * it rides along on this query — which is also the only honest default for a
   * landing target: not every repository merges into `main`.
   */
  baseRefName: string;
}
