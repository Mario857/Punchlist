import { z } from 'zod';

export const REPO_SOURCE = {
  SCAN: 'scan',
  MANUAL: 'manual',
} as const;

export type RepoSource = (typeof REPO_SOURCE)[keyof typeof REPO_SOURCE];

const repoSourceSchema = z.enum([REPO_SOURCE.SCAN, REPO_SOURCE.MANUAL]);

/** A PR is identified by the owner/repo key of its base repo plus its number. */
export const prRefSchema = z.object({
  repoKey: z.string(),
  number: z.number().int().positive(),
});

export const localRepoSchema = z.object({
  path: z.string(),
  name: z.string(),
  /**
   * Every remote reduced to an owner/repo key, not only origin. In a fork
   * workflow the PR belongs to the upstream repo while origin points at your
   * fork, so matching on origin alone would fail exactly when you are
   * contributing to someone else's project.
   */
  repoKeys: z.array(z.string()),
  source: repoSourceSchema,
});

/**
 * The fields `gh search prs --json` actually returns. An unresolved-comment
 * count is deliberately absent: it needs the per-PR reviewThreads query, so it
 * is a separate lookup rather than something discovery can pretend to know.
 */
export const discoveredPrSchema = z.object({
  repoKey: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  updatedAt: z.string(),
  isDraft: z.boolean(),
});

export const prListItemSchema = discoveredPrSchema.extend({
  /**
   * Discovery is global but resolution needs a local clone, because worktrees
   * do. Null is what renders the not-cloned marker.
   */
  localRepoPath: z.string().nullable(),
});

export const ghAuthStatusSchema = z.object({
  isAuthenticated: z.boolean(),
  login: z.string().nullable(),
  host: z.string().nullable(),
  scopes: z.array(z.string()),
});

export type PrRef = z.infer<typeof prRefSchema>;
export type LocalRepo = z.infer<typeof localRepoSchema>;
export type DiscoveredPr = z.infer<typeof discoveredPrSchema>;
export type PrListItem = z.infer<typeof prListItemSchema>;
export type GhAuthStatus = z.infer<typeof ghAuthStatusSchema>;

const REPO_KEY_SEPARATOR = '/';
const PR_REF_KEY_SEPARATOR = '#';
const GIT_SUFFIX = '.git';
const SCP_LIKE_SEPARATOR = ':';

/**
 * Reduces any git remote form — `git@host:owner/repo.git`,
 * `https://host/owner/repo.git`, `ssh://git@host/owner/repo` — to a single
 * `owner/repo` key so remotes can be compared to a PR's base repo. Lowercased
 * because GitHub treats owner and repo names case-insensitively, and a key that
 * only matches on exact casing would miss clones written a different way.
 */
export function normalizeRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  // In the scp-like form the colon separates host from path; every other form
  // uses a slash by this point.
  const pathStart = withoutScheme.includes(SCP_LIKE_SEPARATOR)
    ? withoutScheme.indexOf(SCP_LIKE_SEPARATOR) + 1
    : withoutScheme.indexOf(REPO_KEY_SEPARATOR) + 1;
  if (pathStart <= 0) return null;

  const path = withoutScheme.slice(pathStart);
  const withoutSuffix = path.endsWith(GIT_SUFFIX) ? path.slice(0, -GIT_SUFFIX.length) : path;
  const segments = withoutSuffix.split(REPO_KEY_SEPARATOR).filter((part) => part.length > 0);
  if (segments.length < 2) return null;

  const owner = segments.at(-2);
  const repo = segments.at(-1);
  if (owner === undefined || repo === undefined) return null;

  return `${owner}${REPO_KEY_SEPARATOR}${repo}`.toLowerCase();
}

/** Stable string key for a PR, used for per-PR maps in the persisted session. */
export function prRefKey(ref: PrRef): string {
  return `${ref.repoKey}${PR_REF_KEY_SEPARATOR}${ref.number}`;
}
