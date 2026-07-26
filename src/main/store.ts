import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { z } from 'zod';
import { localRepoSchema, type LocalRepo } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import { DEFAULT_WATCHER_STATE, watcherStateSchema, type WatcherState } from '@shared/automation';
import { runRecordSchema, type RunRecord } from '@shared/runs';
import {
  appSettingsSchema,
  DEFAULT_APP_SETTINGS,
  DEFAULT_SESSION_STATE,
  sessionStateSchema,
  type AppSettings,
  type SessionState,
} from '@shared/settings';

/**
 * State is a single JSON file rather than SQLite: the workload is tens of records,
 * and a native module would have to be rebuilt against every Electron version.
 *
 * The encrypted key lives in its own file so the state file can be opened and read
 * by hand without ciphertext in the middle of it.
 */
const STATE_FILE_NAME = 'airlock-state.json';
const CURSOR_API_KEY_FILE_NAME = 'cursor-api-key.enc';
const TEMP_FILE_SUFFIX = '.tmp';
const FILE_ENCODING = 'utf8';
const JSON_INDENT_SPACES = 2;

const STORE_LOG_SCOPE = '[store]';

const CURSOR_KEY_EMPTY_REMEDIATION = 'Paste the key from cursor.com/settings into Settings.';
const KEYCHAIN_UNAVAILABLE_REMEDIATION =
  'Unlock the login keychain (Keychain Access), then set the key again.';

const localReposSchema = z.array(localRepoSchema);

const RUN_NOT_FOUND_INDEX = -1;

/**
 * The persisted store is one of the three mandated Zod boundaries — this file may
 * have been written by an older version of the app. Every section defaults, so a
 * record missing fields widens to the current shape instead of needing migration
 * code, and a newer version's extra keys are simply stripped.
 */
const persistedStateSchema = z.object({
  settings: appSettingsSchema.default(DEFAULT_APP_SETTINGS),
  repos: localReposSchema.default([]),
  session: sessionStateSchema.default(DEFAULT_SESSION_STATE),
  /**
   * Runs outlive their worktrees: the record and its transcript live here, not in
   * the sandbox, so landing history stays inspectable after the directory is gone.
   */
  runs: z.array(runRecordSchema).default([]),
  /**
   * What the watcher remembers between polls. Persisted so a restart does not
   * re-trigger history: every comment on the PR would otherwise look new.
   */
  watcher: watcherStateSchema.default(DEFAULT_WATCHER_STATE),
});

type PersistedState = z.infer<typeof persistedStateSchema>;

const DEFAULT_PERSISTED_STATE: PersistedState = persistedStateSchema.parse({});

let cachedState: PersistedState = DEFAULT_PERSISTED_STATE;
/** Kept encrypted in memory; it is decrypted only when a caller actually needs it. */
let cachedCursorApiKeyCiphertext: Buffer | null = null;

function resolveStateFilePath(): string {
  return join(app.getPath('userData'), STATE_FILE_NAME);
}

function resolveCursorApiKeyFilePath(): string {
  return join(app.getPath('userData'), CURSOR_API_KEY_FILE_NAME);
}

function writeFileAtomically(filePath: string, contents: string | Buffer): void {
  const tempPath = `${filePath}${TEMP_FILE_SUFFIX}`;
  // rename is atomic within a directory, so a crash mid-write leaves the previous
  // file intact rather than a truncated one that fails to parse on the next boot.
  writeFileSync(tempPath, contents);
  renameSync(tempPath, filePath);
}

function readPersistedState(): PersistedState {
  const filePath = resolveStateFilePath();
  if (!existsSync(filePath)) return DEFAULT_PERSISTED_STATE;

  const decoded = ((): unknown => {
    try {
      return JSON.parse(readFileSync(filePath, FILE_ENCODING));
    } catch (error: unknown) {
      console.warn(STORE_LOG_SCOPE, 'State file could not be read as JSON; using defaults.', error);
      return undefined;
    }
  })();

  const parsed = persistedStateSchema.safeParse(decoded);
  if (!parsed.success) {
    console.warn(
      STORE_LOG_SCOPE,
      'State file has an unexpected shape; using defaults.',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
    return DEFAULT_PERSISTED_STATE;
  }

  return parsed.data;
}

function readCursorApiKeyCiphertext(): Buffer | null {
  const filePath = resolveCursorApiKeyFilePath();
  if (!existsSync(filePath)) return null;

  try {
    return readFileSync(filePath);
  } catch (error: unknown) {
    console.warn(STORE_LOG_SCOPE, 'Stored Cursor API key could not be read.', error);
    return null;
  }
}

// The cache is committed only after the write succeeds, so memory never claims a
// value the disk does not hold.
function commitState(next: PersistedState): void {
  writeFileAtomically(resolveStateFilePath(), JSON.stringify(next, null, JSON_INDENT_SPACES));
  cachedState = next;
}

export function loadStore(): void {
  cachedState = readPersistedState();
  cachedCursorApiKeyCiphertext = readCursorApiKeyCiphertext();
}

export function getSettings(): AppSettings {
  return cachedState.settings;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  // Re-parsed before it is written: persisting an out-of-range value would make the
  // whole state file fail to parse on the next boot and reset everything else too.
  const settings = appSettingsSchema.parse({ ...cachedState.settings, ...patch });
  commitState({ ...cachedState, settings });
  return settings;
}

export function getRepos(): LocalRepo[] {
  return cachedState.repos;
}

export function setRepos(repos: readonly LocalRepo[]): LocalRepo[] {
  const parsed = localReposSchema.parse(repos);
  commitState({ ...cachedState, repos: parsed });
  return parsed;
}

export function getSession(): SessionState {
  return cachedState.session;
}

export function updateSession(patch: Partial<SessionState>): SessionState {
  const session = sessionStateSchema.parse({ ...cachedState.session, ...patch });
  commitState({ ...cachedState, session });
  return session;
}

export function getRuns(): RunRecord[] {
  return cachedState.runs;
}

export function getRunById(runId: string): RunRecord | null {
  return cachedState.runs.find((run) => run.id === runId) ?? null;
}

/**
 * Re-parsed before writing, like every other mutator here: persisting a record the
 * schema would reject means the next boot's parse fails and resets all other state.
 */
export function upsertRun(run: RunRecord): RunRecord {
  const parsed = runRecordSchema.parse(run);
  const existingIndex = cachedState.runs.findIndex((candidate) => candidate.id === parsed.id);
  const runs =
    existingIndex === RUN_NOT_FOUND_INDEX
      ? [...cachedState.runs, parsed]
      : cachedState.runs.map((candidate) => (candidate.id === parsed.id ? parsed : candidate));
  commitState({ ...cachedState, runs });
  return parsed;
}

export function deleteRun(runId: string): void {
  const runs = cachedState.runs.filter((run) => run.id !== runId);
  commitState({ ...cachedState, runs });
}

export function getWatcherState(): WatcherState {
  return cachedState.watcher;
}

export function updateWatcherState(patch: Partial<WatcherState>): WatcherState {
  const watcher = watcherStateSchema.parse({ ...cachedState.watcher, ...patch });
  commitState({ ...cachedState, watcher });
  return watcher;
}

export function isCursorApiKeySet(): boolean {
  return cachedCursorApiKeyCiphertext !== null;
}

export function getCursorApiKey(): string | null {
  if (cachedCursorApiKeyCiphertext === null) return null;

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(STORE_LOG_SCOPE, 'The OS keychain is unavailable, so the stored key is unusable.');
    return null;
  }

  try {
    return safeStorage.decryptString(cachedCursorApiKeyCiphertext);
  } catch (error: unknown) {
    // A keychain reset, a new machine, or a different OS user makes existing
    // ciphertext undecryptable; the caller re-prompts instead of the app crashing.
    console.warn(STORE_LOG_SCOPE, 'Stored Cursor API key could not be decrypted.', error);
    return null;
  }
}

export function setCursorApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new AppError(
      APP_ERROR_KIND.CURSOR_KEY_MISSING,
      'The Cursor API key cannot be empty.',
      CURSOR_KEY_EMPTY_REMEDIATION,
    );
  }

  // Falling back to plaintext would defeat the only reason this file exists, so an
  // unavailable keychain fails loudly and nothing is written.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError(
      APP_ERROR_KIND.CURSOR_KEY_MISSING,
      'The OS keychain is unavailable, so the Cursor API key cannot be stored encrypted.',
      KEYCHAIN_UNAVAILABLE_REMEDIATION,
    );
  }

  const ciphertext = safeStorage.encryptString(trimmed);
  writeFileAtomically(resolveCursorApiKeyFilePath(), ciphertext);
  cachedCursorApiKeyCiphertext = ciphertext;
}
