import { BrowserWindow, dialog, ipcMain } from 'electron';
import { z } from 'zod';
import { prRefSchema } from '@shared/discovery';
import { CONVENTION_STATE } from '@shared/conventions';
import { MODEL_TIER } from '@shared/runState';
import { SELECTION_SIDE } from '@shared/runs';
import { APP_ERROR_KIND, AppError, toErrorPayload, type IpcResult } from '@shared/errors';
import { IPC_CHANNEL, IPC_EVENT_CHANNEL, type IpcChannel } from '@shared/ipcContract';
import { appSettingsSchema, sessionStateSchema } from '@shared/settings';
import { listAuditEntries } from './audit';
import {
  captureCommentEvidence,
  distillConventions,
  exportConventions,
  previewConventionExport,
  setConventionRuleState,
} from './conventions';
import { setLandingInProgress } from './automation';
import {
  assembleLanding,
  executeLanding,
  findUndoableLanding,
  LANDING_GATE_ACTION,
  undoLanding,
  UNDO_LANDING_GATE_ACTION,
} from './landing';
import { confirmSandboxExit, SANDBOX_EXIT_ACTION } from './sandbox';
import { isAutoModeEnabled, setAutoModeEnabled } from './autoMode';
import { enqueueRuns, escalateRun, rerunConflictedRun, stopAllRuns } from './queue';
import {
  acknowledgeGuardrail,
  approveRuns,
  cancelRun,
  cleanupTerminalRuns,
  continueRun,
  dismissRun,
  getRunPatch,
  listRunRevisionTrail,
  listRunsForPr,
  rejectRuns,
  requestSecondOpinion,
  revertRun,
  writeRunFile,
  setRunEventListener,
} from './run';
import { listModelCatalog } from './router';
import { readSandboxUsage } from './worktree';
import {
  addRepoByPath,
  cloneRepoForKey,
  discoverPrs,
  listRepos,
  removeRepoByPath,
  rescanRepos,
  resolvePrUrl,
} from './discovery';
import { getGhAuthStatus } from './ghCli';
import { fetchPrComments, fetchPrStatus } from './github';
import {
  getConventionRules,
  getSession,
  getSettings,
  isCursorApiKeySet,
  updateSession,
  updateSettings,
} from './store';

const CLONE_CANCELLED_MESSAGE = 'No folder was chosen, so nothing was cloned.';

/** An empty branch name would resolve to whatever git happened to be on. */
const MIN_BRANCH_NAME_LENGTH = 1;

/** An empty follow-up would resume the agent with nothing to act on. */
const MIN_CONTINUATION_MESSAGE_LENGTH = 1;

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

const targetedEditSelectionSchema = z.object({
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  content: z.string(),
  side: z.enum(SELECTION_SIDE),
});

const continueRunPayloadSchema = z.object({
  runId: z.string(),
  message: z.string().min(MIN_CONTINUATION_MESSAGE_LENGTH),
  selection: targetedEditSelectionSchema.nullish(),
});

const writeRunFilePayloadSchema = z.object({
  runId: z.string(),
  path: z.string(),
  // Deliberately unconstrained: emptying a file is a legal hand edit.
  content: z.string(),
});

const landingCommitPlanSchema = z.object({
  runId: z.string(),
  commentId: z.string(),
  subject: z.string(),
  body: z.string(),
});

const executeLandingPayloadSchema = z.object({
  prRef: prRefSchema,
  targetBranch: z.string().min(MIN_BRANCH_NAME_LENGTH),
  commits: z.array(landingCommitPlanSchema),
  replyText: z.string().nullable(),
  acknowledgedGuardrailIds: z.array(z.string()),
  isConfirmedByUser: z.boolean(),
});

const undoLandingPayloadSchema = z.object({
  landingId: z.string(),
  isConfirmedByUser: z.boolean(),
});

const assembleLandingPayloadSchema = z.object({
  prRef: prRefSchema,
  targetBranch: z.string().min(MIN_BRANCH_NAME_LENGTH),
});

/**
 * Automation must not race the integration branch, so it is paused for the whole
 * landing and resumed whether it succeeded or not.
 */
async function withLandingPaused<T>(work: () => Promise<T>): Promise<T> {
  setLandingInProgress(true);
  try {
    return await work();
  } finally {
    setLandingInProgress(false);
  }
}

/** Bulk approve and reject are the same operation applied to many, so one schema. */
const runIdsPayloadSchema = z.array(z.string());

const setConventionStatePayloadSchema = z.object({
  ruleId: z.string(),
  state: z.enum(CONVENTION_STATE),
});

const exportConventionsPayloadSchema = z.object({
  repoKey: z.string(),
  isConfirmedByUser: z.boolean(),
});

const revertRunPayloadSchema = z.object({
  runId: z.string(),
  revision: z.string(),
  isDiscardConfirmed: z.boolean(),
});

const acknowledgeGuardrailPayloadSchema = z.object({
  runId: z.string(),
  flagId: z.string(),
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
  registerHandler(IPC_CHANNEL.REPOS_CLONE, z.string(), async (repoKey) => {
    // The configured scan root is the obvious home for a new clone, and it means the
    // repo is found again by a later rescan. Without one, the destination is asked
    // for rather than guessed — this writes a directory onto a real filesystem.
    const scanRoot = getSettings().repoScanRoot;
    const destinationParent = scanRoot ?? (await pickRepoDirectory());
    if (destinationParent === null) {
      throw new AppError(APP_ERROR_KIND.NOT_FOUND, CLONE_CANCELLED_MESSAGE, null);
    }
    return cloneRepoForKey(repoKey, destinationParent);
  });

  registerHandler(IPC_CHANNEL.PRS_DISCOVER, noPayloadSchema, () => discoverPrs());
  registerHandler(IPC_CHANNEL.PRS_RESOLVE_URL, z.string(), (url) => resolvePrUrl(url));
  registerHandler(IPC_CHANNEL.PRS_STATUS, prRefSchema, (ref) => fetchPrStatus(ref));

  registerHandler(IPC_CHANNEL.COMMENTS_FETCH, prRefSchema, async (ref) => {
    const comments = await fetchPrComments(ref);
    // Capture piggybacks on ingestion: it is a store write, deduped on comment id, so
    // a refresh cannot inflate the recurrence count everything else is measured by.
    captureCommentEvidence(ref, comments);
    return comments;
  });

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
  registerHandler(IPC_CHANNEL.RUNS_APPROVE, runIdsPayloadSchema, (runIds) => approveRuns(runIds));
  registerHandler(IPC_CHANNEL.RUNS_REJECT, runIdsPayloadSchema, (runIds) => rejectRuns(runIds));
  registerHandler(IPC_CHANNEL.RUNS_SECOND_OPINION, runIdsPayloadSchema, (runIds) =>
    requestSecondOpinion(runIds),
  );
  registerHandler(IPC_CHANNEL.RUNS_CONTINUE, continueRunPayloadSchema, (request) =>
    continueRun(request),
  );
  registerHandler(IPC_CHANNEL.RUNS_WRITE_FILE, writeRunFilePayloadSchema, (request) =>
    writeRunFile(request),
  );
  registerHandler(IPC_CHANNEL.RUNS_REVISIONS, z.string(), (runId) => listRunRevisionTrail(runId));
  registerHandler(IPC_CHANNEL.RUNS_REVERT, revertRunPayloadSchema, (request) => revertRun(request));
  registerHandler(IPC_CHANNEL.RUNS_RERUN_CONFLICTED, z.string(), (runId) =>
    rerunConflictedRun(runId),
  );
  registerHandler(
    IPC_CHANNEL.RUNS_ACKNOWLEDGE_GUARDRAIL,
    acknowledgeGuardrailPayloadSchema,
    ({ runId, flagId }) => acknowledgeGuardrail(runId, flagId),
  );
  registerHandler(IPC_CHANNEL.RUNS_ESCALATE, escalateRunPayloadSchema, (request) =>
    escalateRun(request),
  );

  // Off on every app start by construction: this reads module state in main, not a
  // persisted setting, so there is nothing that could carry it across a restart.
  registerHandler(IPC_CHANNEL.RUNS_GET_AUTO_MODE, noPayloadSchema, () => isAutoModeEnabled());
  registerHandler(IPC_CHANNEL.RUNS_SET_AUTO_MODE, z.boolean(), (isEnabled) =>
    setAutoModeEnabled(isEnabled),
  );

  // The settings card forces a refresh so a newly-granted model appears without a
  // restart; the run path takes the cached catalog.
  registerHandler(IPC_CHANNEL.MODELS_LIST, noPayloadSchema, () =>
    listModelCatalog({ shouldRefresh: true }),
  );

  registerHandler(IPC_CHANNEL.LANDING_ASSEMBLE, assembleLandingPayloadSchema, (request) =>
    assembleLanding(request),
  );

  // The confirmation is minted here, from the same call that carries the reviewed
  // commits, and nowhere else. That is what makes the branded type meaningful: no
  // handler can reach a push, a thread resolve or a reply without one.
  registerHandler(IPC_CHANNEL.LANDING_EXECUTE, executeLandingPayloadSchema, (request) =>
    // Paused from here rather than inside landing.ts: queue.ts imports landing.ts and
    // automation.ts imports queue.ts, so landing reaching for automation would close a
    // module cycle.
    withLandingPaused(() =>
      executeLanding(
        request,
        confirmSandboxExit({
          action: LANDING_GATE_ACTION,
          isConfirmedByUser: request.isConfirmedByUser,
        }),
      ),
    ),
  );
  registerHandler(IPC_CHANNEL.LANDING_UNDOABLE, noPayloadSchema, () => findUndoableLanding());
  registerHandler(IPC_CHANNEL.LANDING_UNDO, undoLandingPayloadSchema, (request) =>
    withLandingPaused(() =>
      undoLanding(
        request,
        confirmSandboxExit({
          action: UNDO_LANDING_GATE_ACTION,
          isConfirmedByUser: request.isConfirmedByUser,
        }),
      ),
    ),
  );

  registerHandler(IPC_CHANNEL.CONVENTIONS_LIST, noPayloadSchema, () => getConventionRules());
  registerHandler(IPC_CHANNEL.CONVENTIONS_DISTILL, noPayloadSchema, () => distillConventions());
  registerHandler(IPC_CHANNEL.CONVENTIONS_SET_STATE, setConventionStatePayloadSchema, (request) =>
    setConventionRuleState(request.ruleId, request.state),
  );
  registerHandler(IPC_CHANNEL.CONVENTIONS_EXPORT_PREVIEW, z.string(), (repoKey) =>
    previewConventionExport(repoKey),
  );
  // Gated exactly like a landing: the confirmation is minted here, from the call that
  // carries it, and the path written is one the guardrails otherwise protect.
  registerHandler(IPC_CHANNEL.CONVENTIONS_EXPORT, exportConventionsPayloadSchema, (request) =>
    exportConventions(
      request,
      confirmSandboxExit({
        action: SANDBOX_EXIT_ACTION.EXPORT_CONVENTIONS,
        isConfirmedByUser: request.isConfirmedByUser,
      }),
    ),
  );

  registerHandler(IPC_CHANNEL.AUDIT_LIST, noPayloadSchema, () => listAuditEntries());

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
