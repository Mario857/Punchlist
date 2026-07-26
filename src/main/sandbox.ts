import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { simpleGit } from 'simple-git';
import { APP_ERROR_KIND, AppError } from '@shared/errors';

/**
 * A worktree shares the parent repo's remotes and credentials, so an agent with
 * shell access could push on its own, and a prompt telling it not to is a request
 * rather than a guarantee. An unresolvable URL scheme makes the attempt fail inside
 * git itself.
 */
const INVALID_PUSH_URL = 'punchlist-sandbox://push-disabled';

const WORKTREE_CONFIG_EXTENSION_KEY = 'extensions.worktreeConfig';
const WORKTREE_CONFIG_EXTENSION_VALUE = 'true';
const REMOTE_CONFIG_KEY_PREFIX = 'remote.';
const PUSH_URL_CONFIG_KEY_SUFFIX = '.pushurl';
const USER_NAME_CONFIG_KEY = 'user.name';
const USER_EMAIL_CONFIG_KEY = 'user.email';

/** simple-git names the config file to write rather than passing a `--scope` flag. */
const GIT_CONFIG_SCOPE = { LOCAL: 'local', WORKTREE: 'worktree' } as const;
const SHOULD_APPEND_CONFIG = false;

/**
 * `gh` reads its credentials from this directory, so pointing it at an empty one
 * de-authenticates the agent's CLI while the main process keeps working normally.
 * Nothing is ever written here by us.
 */
const AGENT_GH_CONFIG_DIRECTORY_NAME = 'agent-gh-config';
const GH_CONFIG_DIR_ENVIRONMENT_KEY = 'GH_CONFIG_DIR';

/** Cleared rather than deleted, so the containment is visible in the env it hands over. */
const CLEARED_TOKEN_ENVIRONMENT_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN'] as const;
const CLEARED_ENVIRONMENT_VALUE = '';

/**
 * These override git config, so leaving them in place would defeat the
 * worktree-scoped identity below.
 */
const SCRUBBED_ENVIRONMENT_KEYS: ReadonlySet<string> = new Set([
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'EMAIL',
]);

const GIT_IDENTITY_REMEDIATION =
  'git config --global user.name "Your Name" && git config --global user.email "you@example.com"';
const CONFIRMATION_REQUIRED_REMEDIATION = 'Confirm the action in the landing preview.';

export interface GitIdentity {
  name: string;
  email: string;
}

export interface ContainWorktreeOptions {
  repoPath: string;
  worktreePath: string;
  identity: GitIdentity;
}

function resolveAgentGhConfigDirectory(): string {
  return join(app.getPath('userData'), AGENT_GH_CONFIG_DIRECTORY_NAME);
}

function readConfiguredValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Read from the repo's effective config, so a per-repo `user.email` beats the global
 * one exactly as it would for a hand-typed commit. Exported because it is a
 * preflight: an unset identity has no sensible default to invent, and discovering
 * that after an agent has finished would throw the whole run away.
 */
export async function resolveGitIdentity(repoPath: string): Promise<GitIdentity> {
  const git = simpleGit(repoPath);
  const name = readConfiguredValue((await git.getConfig(USER_NAME_CONFIG_KEY)).value);
  const email = readConfiguredValue((await git.getConfig(USER_EMAIL_CONFIG_KEY)).value);

  if (name === null || email === null) {
    const missing = [
      name === null ? USER_NAME_CONFIG_KEY : null,
      email === null ? USER_EMAIL_CONFIG_KEY : null,
    ].filter((key): key is string => key !== null);

    throw new AppError(
      APP_ERROR_KIND.GIT_IDENTITY_UNSET,
      `${repoPath} has no git identity: ${missing.join(' and ')} is unset, and every commit has to be authored by you.`,
      GIT_IDENTITY_REMEDIATION,
    );
  }

  return { name, email };
}

/**
 * Worktree-scoped config lives in the worktree's own config file, which
 * `git worktree remove` takes with it. It requires `extensions.worktreeConfig`, so
 * `containWorktree` has to have run against this worktree first.
 */
export async function setWorktreeConfig(
  worktreePath: string,
  key: string,
  value: string,
): Promise<void> {
  await simpleGit(worktreePath).addConfig(
    key,
    value,
    SHOULD_APPEND_CONFIG,
    GIT_CONFIG_SCOPE.WORKTREE,
  );
}

/**
 * Structural containment for one worktree: pushing fails at the git level, and
 * anything that commits in here — including the agent, which has shell access — is
 * attributed to the user as both author and committer.
 */
export async function containWorktree(options: ContainWorktreeOptions): Promise<void> {
  const { repoPath, worktreePath, identity } = options;

  // Enabled first: `git config --worktree` is rejected outright until the extension
  // is on, which makes this the load-bearing line rather than a formality.
  await simpleGit(repoPath).addConfig(
    WORKTREE_CONFIG_EXTENSION_KEY,
    WORKTREE_CONFIG_EXTENSION_VALUE,
    SHOULD_APPEND_CONFIG,
    GIT_CONFIG_SCOPE.LOCAL,
  );

  // Every remote, not only origin: in a fork workflow origin is your fork and the
  // base repo is a second remote, so containment that covers one leaves the other
  // writable.
  const remotes = await simpleGit(worktreePath).getRemotes(false);
  for (const remote of remotes) {
    const pushUrlKey = `${REMOTE_CONFIG_KEY_PREFIX}${remote.name}${PUSH_URL_CONFIG_KEY_SUFFIX}`;
    await setWorktreeConfig(worktreePath, pushUrlKey, INVALID_PUSH_URL);
  }

  await setWorktreeConfig(worktreePath, USER_NAME_CONFIG_KEY, identity.name);
  await setWorktreeConfig(worktreePath, USER_EMAIL_CONFIG_KEY, identity.email);
}

/**
 * The environment for every agent subprocess. A fresh object rather than a mutation
 * of `process.env`, because main keeps needing its own credentials to talk to `gh`.
 */
export async function buildAgentEnvironment(): Promise<Record<string, string>> {
  const ghConfigDirectory = resolveAgentGhConfigDirectory();
  await mkdir(ghConfigDirectory, { recursive: true });

  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SCRUBBED_ENVIRONMENT_KEYS.has(key)) continue;
    inherited[key] = value;
  }

  for (const key of CLEARED_TOKEN_ENVIRONMENT_KEYS) {
    inherited[key] = CLEARED_ENVIRONMENT_VALUE;
  }
  inherited[GH_CONFIG_DIR_ENVIRONMENT_KEY] = ghConfigDirectory;

  return inherited;
}

/**
 * The credentials main needs for its own `gh` calls, captured before containment
 * removes them from the process. Undefined means the variable was not set, which is
 * different from being set to an empty value and must be preserved as such.
 */
const capturedGhEnvironment = new Map<string, string | undefined>();

let isProcessContained = false;

/**
 * Containment has to be applied to the whole main process, not handed to the agent
 * as an env object, because `@cursor/sdk` has no env override for local agents:
 * `LocalAgentOptions` exposes cwd, settingSources, sandboxOptions and customTools,
 * and `env` appears only on `McpServerConfig` and the cloud options. The agent CLI
 * therefore inherits main's environment, and a per-child env we cannot pass is not
 * containment.
 *
 * Inverting the default is the stronger position anyway: every subprocess is
 * contained unless it explicitly opts out, so a future child we forget about is
 * contained by omission rather than exposed by it. `ghCli` is the single opt-out,
 * via `buildMainGhEnvironment`.
 *
 * Called once, before anything can spawn a subprocess.
 */
export function applyProcessContainment(): void {
  if (isProcessContained) return;

  for (const key of [...CLEARED_TOKEN_ENVIRONMENT_KEYS, GH_CONFIG_DIR_ENVIRONMENT_KEY]) {
    capturedGhEnvironment.set(key, process.env[key]);
  }

  // Deleted rather than emptied: an empty GIT_AUTHOR_NAME would still override the
  // worktree-scoped identity config, just with a useless value.
  for (const key of SCRUBBED_ENVIRONMENT_KEYS) {
    delete process.env[key];
  }
  for (const key of CLEARED_TOKEN_ENVIRONMENT_KEYS) {
    process.env[key] = CLEARED_ENVIRONMENT_VALUE;
  }
  process.env[GH_CONFIG_DIR_ENVIRONMENT_KEY] = resolveAgentGhConfigDirectory();

  isProcessContained = true;
}

/**
 * Main's own `gh` environment: the contained process env with the real credentials
 * restored for this one subprocess. Restoring an originally-unset variable would
 * make `gh` read an empty config dir, so those keys are removed instead.
 */
export function buildMainGhEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of capturedGhEnvironment) {
    if (value === undefined) {
      delete environment[key];
      continue;
    }
    environment[key] = value;
  }
  return environment;
}

/** The operations that reach the real repo or GitHub, and therefore need a gate. */
export const SANDBOX_EXIT_ACTION = {
  COMMIT_INTEGRATION_BRANCH: 'commitIntegrationBranch',
  PUSH_BRANCH: 'pushBranch',
  RESOLVE_REVIEW_THREAD: 'resolveReviewThread',
  UNRESOLVE_REVIEW_THREAD: 'unresolveReviewThread',
  POST_REPLY: 'postReply',
  /** Writing distilled conventions into the user's repository. */
  EXPORT_CONVENTIONS: 'exportConventions',
} as const;

export type SandboxExitAction = (typeof SANDBOX_EXIT_ACTION)[keyof typeof SANDBOX_EXIT_ACTION];

/**
 * Not exported, which is the whole mechanism: a `SandboxConfirmation` cannot be
 * written as an object literal anywhere else in the app, so the only way to hold one
 * is to have gone through the factory below.
 */
const SANDBOX_CONFIRMATION_BRAND: unique symbol = Symbol('punchlist.sandboxConfirmation');

export interface SandboxConfirmation {
  readonly [SANDBOX_CONFIRMATION_BRAND]: true;
  readonly action: SandboxExitAction;
  /** Copied into the audit log entry for the action it authorises. */
  readonly confirmedAt: string;
}

export interface SandboxExitConfirmationRequest {
  action: SandboxExitAction;
  /** True only when the user acted on the confirmation gate itself. */
  isConfirmedByUser: boolean;
}

/**
 * The one place a boolean becomes a confirmation. Everything outside the sandbox
 * takes the minted token instead, because `true` is always in scope and a token
 * carrying the action is not.
 *
 * This has no consumers yet — the first gated operation lands with phase 5 — and
 * that is the point: the type exists so that operation cannot be written without it.
 */
export function confirmSandboxExit(request: SandboxExitConfirmationRequest): SandboxConfirmation {
  if (!request.isConfirmedByUser) {
    throw new AppError(
      APP_ERROR_KIND.CONFIRMATION_REQUIRED,
      `${request.action} leaves the sandbox, so it needs an explicit confirmation.`,
      CONFIRMATION_REQUIRED_REMEDIATION,
    );
  }

  return {
    [SANDBOX_CONFIRMATION_BRAND]: true,
    action: request.action,
    confirmedAt: new Date().toISOString(),
  };
}

function isSandboxExitAction(value: unknown): value is SandboxExitAction {
  if (typeof value !== 'string') return false;
  const actions: readonly string[] = Object.values(SANDBOX_EXIT_ACTION);
  return actions.includes(value);
}

function isSandboxConfirmation(value: unknown): value is SandboxConfirmation {
  if (typeof value !== 'object' || value === null) return false;
  if (!(SANDBOX_CONFIRMATION_BRAND in value)) return false;
  if (value[SANDBOX_CONFIRMATION_BRAND] !== true) return false;
  if (!('action' in value) || !('confirmedAt' in value)) return false;
  return isSandboxExitAction(value.action) && typeof value.confirmedAt === 'string';
}

/**
 * For values whose provenance the compiler cannot see. A confirmation never crosses
 * IPC — structured clone drops the brand — so one is always minted in main, and this
 * is the guard against a path that forgot to. The expected action is checked too:
 * confirming a push does not authorise resolving a thread.
 */
export function assertSandboxConfirmation(
  value: unknown,
  action: SandboxExitAction,
): SandboxConfirmation {
  if (!isSandboxConfirmation(value) || value.action !== action) {
    throw new AppError(
      APP_ERROR_KIND.CONFIRMATION_REQUIRED,
      `${action} was attempted without a confirmation for it.`,
      CONFIRMATION_REQUIRED_REMEDIATION,
    );
  }

  return value;
}
