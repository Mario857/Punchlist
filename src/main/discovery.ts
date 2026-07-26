import type { Dirent } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { simpleGit } from 'simple-git';
import { z } from 'zod';
import { runGhJson } from '@main/ghCli';
import { getRepos, getSettings, setRepos } from '@main/store';
import type { DiscoveredPr, LocalRepo, PrListItem, RepoSource } from '@shared/discovery';
import { REPO_SOURCE, normalizeRemoteUrl } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';

const GIT_ENTRY_NAME = '.git';

/**
 * A home directory is a plausible scan root, so the walk is bounded: an unlimited
 * recursive stat of every file under `~` is a hang, not a feature.
 */
const REPO_SCAN_MAX_DEPTH = 3;

/** `Library` is macOS-sized and never holds a checkout you work in. */
const IGNORED_DIRECTORY_NAMES = new Set(['node_modules', 'Library']);
/** Also skips `.git` interiors, so a repo is never walked into. */
const DOT_DIRECTORY_PREFIX = '.';

/**
 * GitHub's search API is rate limited far more tightly than the regular API, so
 * discovery is a manual or interval refresh rather than a poll, and it takes one
 * capped page rather than paginating. `--sort=updated` makes the cap cut off the
 * stalest PRs instead of arbitrary ones.
 */
const PR_SEARCH_RESULT_LIMIT = 100;
const JSON_FIELD_SEPARATOR = ',';
const PR_SEARCH_JSON_FIELDS = [
  'number',
  'title',
  'url',
  'author',
  'updatedAt',
  'isDraft',
  'repository',
] as const;
const PR_VIEW_JSON_FIELDS = ['number', 'title', 'url', 'author', 'updatedAt', 'isDraft'] as const;

const PR_SEARCH_ARGS = [
  'search',
  'prs',
  '--author=@me',
  '--state=open',
  '--sort=updated',
  '--limit',
  String(PR_SEARCH_RESULT_LIMIT),
  '--json',
  PR_SEARCH_JSON_FIELDS.join(JSON_FIELD_SEPARATOR),
] as const;

/** GitHub attributes a deleted account's work to `ghost`. */
const DELETED_AUTHOR_LOGIN = 'ghost';
const DECIMAL_RADIX = 10;

/**
 * A PR link is usually copied from the browser, so it arrives with the tab
 * (`/files`, `/commits`) and often a `#discussion_r…` fragment attached. Both are
 * tolerated and discarded; only owner/repo and the number carry meaning.
 */
const PR_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:\/[^\s?#]*)?(?:[?#]\S*)?$/i;

const PR_URL_REMEDIATION = 'Paste a link like https://github.com/owner/repo/pull/123.';

const ghAuthorSchema = z.object({ login: z.string() }).nullish();

type GhAuthor = z.infer<typeof ghAuthorSchema>;

/**
 * `gh search prs` nests the repo and the author as objects, so the wire shape is
 * not `discoveredPrSchema` — it is parsed on its own terms and then mapped.
 */
const prSearchResultSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  author: ghAuthorSchema,
  updatedAt: z.string(),
  /** Absent rather than false on some search results. */
  isDraft: z.boolean().nullish(),
  repository: z.object({ nameWithOwner: z.string() }),
});

const prSearchResultsSchema = z.array(prSearchResultSchema);

const prViewResultSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  author: ghAuthorSchema,
  updatedAt: z.string(),
  isDraft: z.boolean(),
});

type PrSearchResult = z.infer<typeof prSearchResultSchema>;

interface PrUrlTarget {
  nameWithOwner: string;
  number: number;
}

function toRepoKey(nameWithOwner: string): string {
  return nameWithOwner.toLowerCase();
}

function readAuthorLogin(author: GhAuthor): string {
  const login = author?.login.trim() ?? '';
  if (login.length === 0) return DELETED_AUTHOR_LOGIN;
  return login;
}

function shouldIgnoreDirectory(name: string): boolean {
  return name.startsWith(DOT_DIRECTORY_PREFIX) || IGNORED_DIRECTORY_NAMES.has(name);
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[] | null> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch {
    // An unreadable directory (permissions, a stale mount) is skipped rather than
    // aborting the whole scan.
    return null;
  }
}

async function hasGitEntry(directoryPath: string): Promise<boolean> {
  try {
    await access(join(directoryPath, GIT_ENTRY_NAME));
    return true;
  } catch {
    return false;
  }
}

async function findRepoPaths(root: string): Promise<string[]> {
  const repoPaths: string[] = [];
  let currentLevel = [resolvePath(root)];

  for (let depth = 0; depth <= REPO_SCAN_MAX_DEPTH && currentLevel.length > 0; depth += 1) {
    const nextLevel: string[] = [];

    for (const directoryPath of currentLevel) {
      const entries = await readDirectoryEntries(directoryPath);
      if (entries === null) continue;

      // In a worktree or a submodule checkout `.git` is a *file* pointing at the
      // real git dir, so existence is the test — never directory-ness.
      if (entries.some((entry) => entry.name === GIT_ENTRY_NAME)) {
        repoPaths.push(directoryPath);
        continue;
      }

      if (depth === REPO_SCAN_MAX_DEPTH) continue;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (shouldIgnoreDirectory(entry.name)) continue;
        nextLevel.push(join(directoryPath, entry.name));
      }
    }

    currentLevel = nextLevel;
  }

  return repoPaths;
}

/** Null means the path is not a usable repository, which callers skip or reject. */
async function readRepoKeys(repoPath: string): Promise<string[] | null> {
  try {
    // Every remote, not only origin: in a fork workflow the PR belongs to the
    // upstream repo while origin points at your fork, so matching origin alone
    // fails exactly when you are contributing to someone else's project. Push URLs
    // are read too, since a remote can fetch and push to different repos.
    const remotes = await simpleGit(repoPath).getRemotes(true);
    const keys = remotes
      .flatMap((remote) => [remote.refs.fetch, remote.refs.push])
      .map((remoteUrl) => normalizeRemoteUrl(remoteUrl))
      .filter((repoKey): repoKey is string => repoKey !== null);
    return [...new Set(keys)];
  } catch {
    return null;
  }
}

async function toLocalRepo(repoPath: string, source: RepoSource): Promise<LocalRepo | null> {
  const repoKeys = await readRepoKeys(repoPath);
  if (repoKeys === null) return null;
  return { path: repoPath, name: basename(repoPath), repoKeys, source };
}

function sortRepos(repos: readonly LocalRepo[]): LocalRepo[] {
  return [...repos].sort((first, second) => {
    const byName = first.name.localeCompare(second.name);
    if (byName !== 0) return byName;
    return first.path.localeCompare(second.path);
  });
}

function buildRepoPathIndex(repos: readonly LocalRepo[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const repo of repos) {
    for (const repoKey of repo.repoKeys) {
      if (!index.has(repoKey)) index.set(repoKey, repo.path);
    }
  }
  return index;
}

function toPrListItem(pr: DiscoveredPr, pathsByRepoKey: ReadonlyMap<string, string>): PrListItem {
  // Discovery is global but a worktree needs a clone, so an unmatched PR is still
  // listed — null is what renders the not-cloned marker.
  return { ...pr, localRepoPath: pathsByRepoKey.get(pr.repoKey) ?? null };
}

function toDiscoveredPr(result: PrSearchResult): DiscoveredPr {
  return {
    repoKey: toRepoKey(result.repository.nameWithOwner),
    number: result.number,
    title: result.title,
    url: result.url,
    author: readAuthorLogin(result.author),
    updatedAt: result.updatedAt,
    isDraft: result.isDraft ?? false,
  };
}

function parsePrUrl(url: string): PrUrlTarget {
  const match = url.trim().match(PR_URL_PATTERN);
  if (match === null) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `"${url}" is not a GitHub pull request URL.`,
      PR_URL_REMEDIATION,
    );
  }

  const [, nameWithOwner, numberText] = match;
  return { nameWithOwner, number: Number.parseInt(numberText, DECIMAL_RADIX) };
}

function buildPrViewArgs(target: PrUrlTarget): readonly string[] {
  return [
    'pr',
    'view',
    String(target.number),
    '--repo',
    target.nameWithOwner,
    '--json',
    PR_VIEW_JSON_FIELDS.join(JSON_FIELD_SEPARATOR),
  ];
}

export async function listRepos(): Promise<LocalRepo[]> {
  return getRepos();
}

export async function rescanRepos(): Promise<LocalRepo[]> {
  const { repoScanRoot } = getSettings();
  const storedRepos = getRepos();

  // A manual add survives a rescan: only the scanned entries are replaced. Their
  // keys are re-read so a remote added since the add starts matching, and an entry
  // that has become unreadable is kept rather than silently dropped — removal is
  // an explicit action.
  const manualRepos = await Promise.all(
    storedRepos
      .filter((repo) => repo.source === REPO_SOURCE.MANUAL)
      .map(async (repo) => (await toLocalRepo(repo.path, REPO_SOURCE.MANUAL)) ?? repo),
  );
  const manualPaths = new Set(manualRepos.map((repo) => repo.path));

  const scannedRepos: LocalRepo[] = [];
  if (repoScanRoot !== null) {
    for (const repoPath of await findRepoPaths(repoScanRoot)) {
      if (manualPaths.has(repoPath)) continue;
      const repo = await toLocalRepo(repoPath, REPO_SOURCE.SCAN);
      if (repo !== null) scannedRepos.push(repo);
    }
  }

  return setRepos(sortRepos([...manualRepos, ...scannedRepos]));
}

export async function addRepoByPath(repoPath: string): Promise<LocalRepo[]> {
  if (!isAbsolute(repoPath)) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `A repository has to be added by absolute path, and "${repoPath}" is relative.`,
      null,
    );
  }

  // Normalized so a trailing slash cannot create a second entry for one repo.
  const absolutePath = resolvePath(repoPath);

  // git resolves a repository by walking up from the given directory, so without
  // this check a subdirectory would register under its own path while reporting the
  // enclosing repo's remotes.
  if (!(await hasGitEntry(absolutePath))) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `${absolutePath} is not the root of a git repository.`,
      'Pick the folder that contains the .git entry.',
    );
  }

  const repo = await toLocalRepo(absolutePath, REPO_SOURCE.MANUAL);
  if (repo === null) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `The git remotes of ${absolutePath} could not be read.`,
      null,
    );
  }

  const others = getRepos().filter((existing) => existing.path !== absolutePath);
  return setRepos(sortRepos([...others, repo]));
}

export async function removeRepoByPath(repoPath: string): Promise<LocalRepo[]> {
  const absolutePath = resolvePath(repoPath);
  return setRepos(getRepos().filter((repo) => repo.path !== absolutePath));
}

export async function discoverPrs(): Promise<PrListItem[]> {
  const results = await runGhJson(PR_SEARCH_ARGS, prSearchResultsSchema);
  const pathsByRepoKey = buildRepoPathIndex(getRepos());
  return results.map((result) => toPrListItem(toDiscoveredPr(result), pathsByRepoKey));
}

export async function resolvePrUrl(url: string): Promise<PrListItem> {
  const target = parsePrUrl(url);
  const result = await runGhJson(buildPrViewArgs(target), prViewResultSchema);

  const discovered: DiscoveredPr = {
    repoKey: toRepoKey(target.nameWithOwner),
    number: result.number,
    title: result.title,
    url: result.url,
    author: readAuthorLogin(result.author),
    updatedAt: result.updatedAt,
    isDraft: result.isDraft,
  };

  return toPrListItem(discovered, buildRepoPathIndex(getRepos()));
}
