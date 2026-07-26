export type QueryKeyPart = string | number;

/**
 * The `const` type parameter keeps the literal tuple, so a key is comparable at
 * the type level instead of collapsing to `string[]`.
 */
export function createQueryKey<const TParts extends readonly QueryKeyPart[]>(
  ...parts: TParts
): TParts {
  return parts;
}

const QUERY_DOMAIN = {
  GH_AUTH_STATUS: 'ghAuthStatus',
  SETTINGS: 'settings',
  REPOS: 'repos',
  DISCOVERED_PRS: 'discoveredPrs',
  PR_COMMENTS: 'prComments',
  SESSION: 'session',
  MODELS: 'models',
  CURSOR_KEY: 'cursorKey',
  RUN_REVISIONS: 'runRevisions',
} as const;

const LIST_SCOPE = 'list';
const CATALOG_SCOPE = 'catalog';
const STATUS_SCOPE = 'status';

/**
 * The only source of TanStack Query cache keys. An ad-hoc array at a call site
 * cannot be invalidated reliably, because nothing keeps the two spellings equal.
 */
export const queryKeys = {
  ghAuthStatus: () => createQueryKey(QUERY_DOMAIN.GH_AUTH_STATUS),
  settings: () => createQueryKey(QUERY_DOMAIN.SETTINGS),
  repos: () => createQueryKey(QUERY_DOMAIN.REPOS, LIST_SCOPE),
  discoveredPrs: () => createQueryKey(QUERY_DOMAIN.DISCOVERED_PRS),
  // Keyed by repo as well as number: two repos both have a PR #1.
  prComments: (repoKey: string, prNumber: number) =>
    createQueryKey(QUERY_DOMAIN.PR_COMMENTS, repoKey, prNumber),
  session: () => createQueryKey(QUERY_DOMAIN.SESSION),
  /**
   * Keyed by revision count as well as run: a hand edit, a targeted edit and a
   * post-decision continuation each add a commit, so a bumped counter is exactly when
   * the trail on disk stopped matching the one already fetched. A revert rewinds the
   * trail without moving that counter, which is why it invalidates this key by hand.
   */
  runRevisions: (runId: string, revisionCount: number) =>
    createQueryKey(QUERY_DOMAIN.RUN_REVISIONS, runId, revisionCount),
  modelCatalog: () => createQueryKey(QUERY_DOMAIN.MODELS, CATALOG_SCOPE),
  cursorKeyStatus: () => createQueryKey(QUERY_DOMAIN.CURSOR_KEY, STATUS_SCOPE),
} as const;
