import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { promisify } from 'node:util';
import { recordSubprocessCall } from '@main/telemetry';
import { z } from 'zod';
// GhAuthStatus crosses IPC to the settings screen, so it lives in src/shared/
// rather than here — one authoritative definition for both processes.
import type { GhAuthStatus } from '@shared/discovery';
import { buildMainGhEnvironment } from '@main/sandbox';
import { APP_ERROR_KIND, AppError } from '@shared/errors';

const execFileAsync = promisify(execFile);

/**
 * Every `gh` call here opts out of the process-wide containment applied in
 * sandbox.ts. Containment is the default for the whole main process because the
 * Cursor SDK has no env override for local agents, so main's own credentials have
 * to be restored explicitly for exactly these subprocesses.
 */
function ghExecOptions(): { maxBuffer: number; env: NodeJS.ProcessEnv } {
  return { maxBuffer: GH_MAX_BUFFER_BYTES, env: buildMainGhEnvironment() };
}

/**
 * A macOS app launched from Finder or the dock gets a minimal PATH rather than the
 * shell's, so a bare `gh` fails even though it works in a terminal. The binary is
 * resolved explicitly instead: the usual install locations first, then the user's
 * login shell as the fallback that knows about anything unusual.
 */
const GH_BINARY_PROBE_PATHS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'] as const;
const DEFAULT_LOGIN_SHELL = '/bin/zsh';
const LOGIN_SHELL_QUERY_ARGS = ['-l', '-c', 'command -v gh'] as const;

const GH_AUTH_STATUS_ARGS = ['auth', 'status'] as const;

/**
 * `gh api graphql --paginate` on a busy PR comfortably exceeds execFile's 1MB
 * default, which would surface as a truncated-output crash rather than an error.
 */
const GH_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

const GH_COMMAND_SUMMARY_ARG_COUNT = 2;
const GH_STDERR_SUMMARY_MAX_LENGTH = 500;

const SYSTEM_ERROR_ENOENT = 'ENOENT';
/** `gh` reserves exit code 4 for "authentication required". */
const GH_EXIT_CODE_AUTH_REQUIRED = 4;

const GH_INSTALL_REMEDIATION = 'brew install gh';
const GH_LOGIN_REMEDIATION = 'gh auth login';
const GH_RATE_LIMIT_REMEDIATION = 'Wait for the GitHub rate limit window to reset, then retry.';
const GH_NETWORK_REMEDIATION = 'Check your network connection, then retry.';
const GH_REPO_ACCESS_REMEDIATION = 'gh auth refresh -h github.com -s repo';

const GH_RATE_LIMITED_PATTERNS = [
  'rate limit',
  'rate-limit',
  'was submitted too quickly',
  'you have exceeded a secondary rate limit',
] as const;

const GH_UNAUTHENTICATED_PATTERNS = [
  'gh auth login',
  'not logged in',
  'not logged into',
  'no accounts are logged in',
  'authentication required',
  'requires authentication',
  'bad credentials',
  'http 401',
  'token is invalid',
  'failed to log in',
] as const;

const GH_NETWORK_PATTERNS = [
  'enotfound',
  'econnrefused',
  'econnreset',
  'etimedout',
  'eai_again',
  'no such host',
  'connection refused',
  'network is unreachable',
  'tls handshake timeout',
  'dial tcp',
  'i/o timeout',
] as const;

const GH_NO_REPO_ACCESS_PATTERNS = [
  'could not resolve to a repository',
  'could not resolve to a pullrequest',
  'http 404',
  'http 403',
  'not found',
  'resource not accessible',
  'must have push access',
  'saml enforcement',
] as const;

/**
 * `gh auth status` moved between stdout and stderr across versions and prints one
 * of two "logged in" phrasings, so both streams are searched with both shapes.
 */
const AUTH_STATUS_HOST_PATTERN = /logged in to (\S+)/i;
const AUTH_STATUS_LOGIN_PATTERN = /logged in to \S+\s+(?:account|as)\s+(\S+)/i;
const AUTH_STATUS_SCOPES_PATTERN = /token scopes:\s*(.+)/i;
const AUTH_STATUS_SCOPE_SEPARATOR = ',';
const AUTH_STATUS_SCOPE_QUOTES = /['"]/g;

interface ExecFailure {
  exitCode: number | null;
  systemErrorCode: string | null;
  stderr: string;
  stdout: string;
}

/**
 * execFile rejects with an Error carrying `code`, `stdout`, and `stderr` bolted on
 * rather than a typed exception, so the shape is parsed instead of trusted.
 */
const execFailureSchema = z.object({
  code: z.union([z.number(), z.string()]).nullish(),
  stderr: z.string().nullish(),
  stdout: z.string().nullish(),
});

let cachedGhBinaryPath: string | null = null;

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readExecFailure(error: unknown): ExecFailure {
  const parsed = execFailureSchema.safeParse(error);
  const message = readErrorMessage(error);
  if (!parsed.success) {
    return { exitCode: null, systemErrorCode: null, stderr: message, stdout: '' };
  }

  const { code, stderr, stdout } = parsed.data;
  const stderrText = stderr ?? '';
  return {
    exitCode: typeof code === 'number' ? code : null,
    systemErrorCode: typeof code === 'string' ? code : null,
    stderr: stderrText.trim().length > 0 ? stderrText : message,
    stdout: stdout ?? '',
  };
}

function matchesAnyPattern(haystack: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => haystack.includes(pattern));
}

function describeGhCommand(args: readonly string[]): string {
  return ['gh', ...args.slice(0, GH_COMMAND_SUMMARY_ARG_COUNT)].join(' ');
}

function summarizeStderr(stderr: string): string {
  const collapsed = stderr.trim().replaceAll(/\s+/g, ' ');
  if (collapsed.length <= GH_STDERR_SUMMARY_MAX_LENGTH) return collapsed;
  return collapsed.slice(0, GH_STDERR_SUMMARY_MAX_LENGTH);
}

function toGhAppError(error: unknown, args: readonly string[]): AppError {
  const failure = readExecFailure(error);
  const context = describeGhCommand(args);
  const detail = summarizeStderr(failure.stderr);
  const message = `${context} failed: ${detail}`;
  const haystack = failure.stderr.toLowerCase();

  if (failure.systemErrorCode === SYSTEM_ERROR_ENOENT) {
    return new AppError(
      APP_ERROR_KIND.GH_MISSING_BINARY,
      `The GitHub CLI could not be executed (${context}).`,
      GH_INSTALL_REMEDIATION,
    );
  }

  // Rate limiting is reported as an HTTP 403, so it has to be classified before
  // the 403 that means "no access to this repository".
  if (matchesAnyPattern(haystack, GH_RATE_LIMITED_PATTERNS)) {
    return new AppError(APP_ERROR_KIND.GH_RATE_LIMITED, message, GH_RATE_LIMIT_REMEDIATION);
  }

  if (
    failure.exitCode === GH_EXIT_CODE_AUTH_REQUIRED ||
    matchesAnyPattern(haystack, GH_UNAUTHENTICATED_PATTERNS)
  ) {
    return new AppError(APP_ERROR_KIND.GH_UNAUTHENTICATED, message, GH_LOGIN_REMEDIATION);
  }

  if (matchesAnyPattern(haystack, GH_NETWORK_PATTERNS)) {
    return new AppError(APP_ERROR_KIND.GH_NETWORK, message, GH_NETWORK_REMEDIATION);
  }

  if (matchesAnyPattern(haystack, GH_NO_REPO_ACCESS_PATTERNS)) {
    return new AppError(APP_ERROR_KIND.GH_NO_REPO_ACCESS, message, GH_REPO_ACCESS_REMEDIATION);
  }

  return new AppError(APP_ERROR_KIND.UNKNOWN, message, null);
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveFromLoginShell(): Promise<string | null> {
  const shell = process.env.SHELL ?? DEFAULT_LOGIN_SHELL;
  try {
    const { stdout } = await execFileAsync(shell, [...LOGIN_SHELL_QUERY_ARGS], ghExecOptions());
    const [firstLine] = stdout.trim().split('\n');
    const candidate = firstLine.trim();
    if (candidate.length === 0) return null;
    if (!(await isExecutableFile(candidate))) return null;
    return candidate;
  } catch {
    return null;
  }
}

export async function resolveGhBinary(): Promise<string> {
  if (cachedGhBinaryPath !== null) return cachedGhBinaryPath;

  for (const candidate of GH_BINARY_PROBE_PATHS) {
    if (await isExecutableFile(candidate)) {
      cachedGhBinaryPath = candidate;
      return candidate;
    }
  }

  const fromLoginShell = await resolveFromLoginShell();
  if (fromLoginShell !== null) {
    cachedGhBinaryPath = fromLoginShell;
    return fromLoginShell;
  }

  throw new AppError(
    APP_ERROR_KIND.GH_MISSING_BINARY,
    'The GitHub CLI (gh) was not found in any known location or on the login shell PATH.',
    GH_INSTALL_REMEDIATION,
  );
}

export async function runGh(args: readonly string[]): Promise<string> {
  const binary = await resolveGhBinary();
  const startedAtMs = Date.now();
  try {
    const { stdout } = await execFileAsync(binary, args, ghExecOptions());
    return stdout;
  } catch (error: unknown) {
    throw toGhAppError(error, args);
  } finally {
    // Counted whether it succeeded or failed — a failing call still spent the time
    // and the rate limit, which is exactly what the Debug screen exists to show.
    recordSubprocessCall(describeGhCommand(args), Date.now() - startedAtMs);
  }
}

export async function runGhJson<T>(args: readonly string[], schema: z.ZodType<T>): Promise<T> {
  const stdout = await runGh(args);

  const decoded = ((): unknown => {
    try {
      return JSON.parse(stdout);
    } catch (error: unknown) {
      throw new AppError(
        APP_ERROR_KIND.GH_MALFORMED_OUTPUT,
        `${describeGhCommand(args)} returned output that is not valid JSON: ${readErrorMessage(error)}`,
        null,
      );
    }
  })();

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      APP_ERROR_KIND.GH_MALFORMED_OUTPUT,
      `${describeGhCommand(args)} returned JSON in an unexpected shape: ${issues}`,
      null,
    );
  }

  return parsed.data;
}

function parseAuthStatusScopes(output: string): string[] {
  const scopesMatch = output.match(AUTH_STATUS_SCOPES_PATTERN);
  if (scopesMatch === null) return [];
  return scopesMatch[1]
    .split(AUTH_STATUS_SCOPE_SEPARATOR)
    .map((scope) => scope.replaceAll(AUTH_STATUS_SCOPE_QUOTES, '').trim())
    .filter((scope) => scope.length > 0);
}

function parseGhAuthStatus(output: string): GhAuthStatus {
  const hostMatch = output.match(AUTH_STATUS_HOST_PATTERN);
  if (hostMatch === null) {
    return { isAuthenticated: false, login: null, host: null, scopes: [] };
  }

  const loginMatch = output.match(AUTH_STATUS_LOGIN_PATTERN);
  const scopes = parseAuthStatusScopes(output);

  return {
    isAuthenticated: true,
    login: loginMatch === null ? null : loginMatch[1],
    host: hostMatch[1],
    scopes,
  };
}

export async function getGhAuthStatus(): Promise<GhAuthStatus> {
  const binary = await resolveGhBinary();

  try {
    const { stdout, stderr } = await execFileAsync(
      binary,
      [...GH_AUTH_STATUS_ARGS],
      ghExecOptions(),
    );
    return parseGhAuthStatus(`${stdout}\n${stderr}`);
  } catch (error: unknown) {
    // `gh auth status` exits non-zero when no host is logged in, which is the
    // preflight's answer rather than a failure — only a genuinely unusable binary
    // is an error here.
    const failure = readExecFailure(error);
    if (failure.systemErrorCode === SYSTEM_ERROR_ENOENT) {
      throw toGhAppError(error, GH_AUTH_STATUS_ARGS);
    }
    return parseGhAuthStatus(`${failure.stdout}\n${failure.stderr}`);
  }
}
