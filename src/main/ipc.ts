import { BrowserWindow, dialog, ipcMain } from 'electron';
import { z } from 'zod';
import { prRefSchema } from '@shared/discovery';
import { MODEL_TIER } from '@shared/runState';
import { toErrorPayload, type IpcResult } from '@shared/errors';
import { IPC_CHANNEL, IPC_EVENT_CHANNEL, type IpcChannel } from '@shared/ipcContract';
import { appSettingsSchema, sessionStateSchema } from '@shared/settings';
import { enqueueRuns, escalateRun, stopAllRuns } from './queue';
import {
  cancelRun,
  cleanupTerminalRuns,
  dismissRun,
  getRunPatch,
  listRunsForPr,
  setRunEventListener,
} from './run';
import { listModelCatalog } from './router';
import { readSandboxUsage } from './worktree';
import {
  addRepoByPath,
  discoverPrs,
  listRepos,
  removeRepoByPath,
  rescanRepos,
  resolvePrUrl,
} from './discovery';
import { getGhAuthStatus } from './ghCli';
import { fetchPrComments } from './github';
import { getSession, getSettings, isCursorApiKeySet, updateSession, updateSettings } from './store';

/** Channels that take no payload; `invoke` with no argument arrives as undefined. */
const noPayloadSchema = z.undefined();

const startRunsPayloadSchema = z.object({
  ref: prRefSchema,
  requests: z.array(
    z.object({
      commentId: z.string(),
      // Null means "use the default"; phase 3's router supplies a real tier.
      tier: z.enum(MODEL_TIER).nullable(),
    }),
  ),
});

const escalateRunPayloadSchema = z.object({
  runId: z.string(),
  shouldUseFrontier: z.boolean(),
  /** Required in practice when crossing lanes; null falls back to the account's first. */
  frontierModelId: z.string().nullable(),
  isDiscardConfirmed: z.boolean(),
});

/**
 * Electron flattens a thrown Error across IPC into a string, which would lose the
 * AppError kind the settings screen needs to pick a remediation. So every handler
 * resolves to an IpcResult instead of throwing, and the renderer narrows on `ok`.
 *
 * The payload schema is not ceremony: an IPC payload is an untrusted boundary like
 * any other, so it is parsed rather than trusted.
 */
function registerHandler<TPayload, TResult>(
  channel: IpcChannel,
  payloadSchema: z.ZodType<TPayload>,
  handler: (payload: TPayload) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, async (_event, rawPayload: unknown): Promise<IpcResult<TResult>> => {
    try {
      const payload = payloadSchema.parse(rawPayload);
      return { ok: true, value: await handler(payload) };
    } catch (error) {
      // The message may quote repository contents, so it goes to the console and
      // never to a log file.
      console.error(`[ipc] ${channel} failed`, error);
      return { ok: false, error: toErrorPayload(error) };
    }
  });
}

/**
 * Resolved per call rather than captured once, because the window is recreated on
 * macOS `activate` and a captured reference would go stale.
 */
async function pickRepoDirectory(): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow();
  const options = { properties: ['openDirectory' as const, 'createDirectory' as const] };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);

  const [directory] = result.filePaths;
  if (result.canceled || directory === undefined) return null;
  return directory;
}

/**
 * The single place a channel is bound to an implementation, and the only file in
 * the app that calls ipcMain.handle. A component never invokes an ad-hoc channel.
 */
export function registerIpcHandlers(): void {
  registerHandler(IPC_CHANNEL.GH_AUTH_STATUS, noPayloadSchema, () => getGhAuthStatus());

  registerHandler(IPC_CHANNEL.SETTINGS_GET, noPayloadSchema, () => getSettings());
  registerHandler(IPC_CHANNEL.SETTINGS_UPDATE, appSettingsSchema.partial(), (patch) =>
    updateSettings(patch),
  );

  registerHandler(IPC_CHANNEL.REPOS_LIST, noPayloadSchema, () => listRepos());
  registerHandler(IPC_CHANNEL.REPOS_RESCAN, noPayloadSchema, () => rescanRepos());
  registerHandler(IPC_CHANNEL.REPOS_ADD_VIA_PICKER, noPayloadSchema, async () => {
    const directory = await pickRepoDirectory();
    if (directory === null) return null;
    const repos = await addRepoByPath(directory);
    return repos.find((repo) => repo.path === directory) ?? null;
  });
  registerHandler(IPC_CHANNEL.REPOS_REMOVE, z.string(), (repoPath) => removeRepoByPath(repoPath));

  registerHandler(IPC_CHANNEL.PRS_DISCOVER, noPayloadSchema, () => discoverPrs());
  registerHandler(IPC_CHANNEL.PRS_RESOLVE_URL, z.string(), (url) => resolvePrUrl(url));

  registerHandler(IPC_CHANNEL.COMMENTS_FETCH, prRefSchema, (ref) => fetchPrComments(ref));

  registerHandler(IPC_CHANNEL.SESSION_GET, noPayloadSchema, () => getSession());
  registerHandler(IPC_CHANNEL.SESSION_UPDATE, sessionStateSchema.partial(), (patch) =>
    updateSession(patch),
  );

  // Whether a key is stored, never its value. The secret stays in main.
  registerHandler(IPC_CHANNEL.CURSOR_KEY_STATUS, noPayloadSchema, () => isCursorApiKeySet());

  registerHandler(IPC_CHANNEL.RUNS_LIST, prRefSchema, (ref) => listRunsForPr(ref));
  registerHandler(IPC_CHANNEL.RUNS_START, startRunsPayloadSchema, ({ ref, requests }) =>
    enqueueRuns(ref, requests),
  );
  registerHandler(IPC_CHANNEL.RUNS_CANCEL, z.string(), (runId) => cancelRun(runId));
  registerHandler(IPC_CHANNEL.RUNS_PATCH, z.string(), (runId) => getRunPatch(runId));
  registerHandler(IPC_CHANNEL.RUNS_DISMISS, z.string(), (runId) => dismissRun(runId));
  registerHandler(IPC_CHANNEL.RUNS_STOP_ALL, noPayloadSchema, () => stopAllRuns());
  registerHandler(IPC_CHANNEL.RUNS_ESCALATE, escalateRunPayloadSchema, (request) =>
    escalateRun(request),
  );

  // The settings card forces a refresh so a newly-granted model appears without a
  // restart; the run path takes the cached catalog.
  registerHandler(IPC_CHANNEL.MODELS_LIST, noPayloadSchema, () =>
    listModelCatalog({ shouldRefresh: true }),
  );

  registerHandler(IPC_CHANNEL.SANDBOX_USAGE, noPayloadSchema, () => readSandboxUsage());
  registerHandler(IPC_CHANNEL.SANDBOX_CLEANUP, noPayloadSchema, () => cleanupTerminalRuns());

  // Transport for the push stream. run.ts knows something wants to hear about
  // progress; it does not know a BrowserWindow exists.
  setRunEventListener((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(IPC_EVENT_CHANNEL.RUN_EVENT, event);
    }
  });
}
