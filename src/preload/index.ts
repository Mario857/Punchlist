import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PrComment } from '@shared/comments';
import type { GhAuthStatus, LocalRepo, PrListItem, PrRef } from '@shared/discovery';
import type { IpcResult } from '@shared/errors';
import { IPC_CHANNEL, IPC_EVENT_CHANNEL, type AirlockApi } from '@shared/ipcContract';
import type { ModelCatalogEntry } from '@shared/models';
import type {
  AcknowledgeGuardrailRequest,
  CandidatePatch,
  ContinueRunRequest,
  EscalateRunRequest,
  RunEvent,
  RunRecord,
  SandboxUsage,
  StartRunRequest,
} from '@shared/runs';
import type { AppSettings, SessionState } from '@shared/settings';

/**
 * The renderer is handed this typed object and never `ipcRenderer` itself:
 * exposing a general-purpose invoke function would defeat the boundary it exists
 * to draw. Every channel used here is registered in src/main/ipc.ts, and there is
 * no other way across.
 */
const api: AirlockApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  gh: {
    getAuthStatus: (): Promise<IpcResult<GhAuthStatus>> =>
      ipcRenderer.invoke(IPC_CHANNEL.GH_AUTH_STATUS),
  },
  settings: {
    get: (): Promise<IpcResult<AppSettings>> => ipcRenderer.invoke(IPC_CHANNEL.SETTINGS_GET),
    update: (patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>> =>
      ipcRenderer.invoke(IPC_CHANNEL.SETTINGS_UPDATE, patch),
  },
  repos: {
    list: (): Promise<IpcResult<LocalRepo[]>> => ipcRenderer.invoke(IPC_CHANNEL.REPOS_LIST),
    rescan: (): Promise<IpcResult<LocalRepo[]>> => ipcRenderer.invoke(IPC_CHANNEL.REPOS_RESCAN),
    addViaPicker: (): Promise<IpcResult<LocalRepo | null>> =>
      ipcRenderer.invoke(IPC_CHANNEL.REPOS_ADD_VIA_PICKER),
    remove: (repoPath: string): Promise<IpcResult<LocalRepo[]>> =>
      ipcRenderer.invoke(IPC_CHANNEL.REPOS_REMOVE, repoPath),
  },
  prs: {
    discover: (): Promise<IpcResult<PrListItem[]>> => ipcRenderer.invoke(IPC_CHANNEL.PRS_DISCOVER),
    resolveUrl: (url: string): Promise<IpcResult<PrListItem>> =>
      ipcRenderer.invoke(IPC_CHANNEL.PRS_RESOLVE_URL, url),
  },
  comments: {
    fetch: (ref: PrRef): Promise<IpcResult<PrComment[]>> =>
      ipcRenderer.invoke(IPC_CHANNEL.COMMENTS_FETCH, ref),
  },
  session: {
    get: (): Promise<IpcResult<SessionState>> => ipcRenderer.invoke(IPC_CHANNEL.SESSION_GET),
    update: (patch: Partial<SessionState>): Promise<IpcResult<SessionState>> =>
      ipcRenderer.invoke(IPC_CHANNEL.SESSION_UPDATE, patch),
  },
  cursorKey: {
    isSet: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC_CHANNEL.CURSOR_KEY_STATUS),
  },
  runs: {
    list: (ref: PrRef): Promise<IpcResult<RunRecord[]>> =>
      ipcRenderer.invoke(IPC_CHANNEL.RUNS_LIST, ref),
    start: (ref: PrRef, requests: StartRunRequest[]): Promise<IpcResult<RunRecord[]>> =>
      ipcRenderer.invoke(IPC_CHANNEL.RUNS_START, { ref, requests }),
    cancel: (runId: string): Promise<IpcResult<RunRecord>> =>
      ipcRenderer.invoke(IPC_CHANNEL.RUNS_CANCEL, runId),
    getPatch: (runId: string): Promise<IpcResult<CandidatePatch>> =>
      ipcRenderer.invoke(IPC_CHANNEL.RUNS_PATCH, runId),
    dismiss: (runId: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC_CHANNEL.RUNS_DISMISS, runId),
    stopAll: (): Promise<IpcResult<RunRecord[]>> => ipcRenderer.invoke(IPC_CHANNEL.RUNS_STOP_ALL),
    continueRun: (request: ContinueRunRequest): Promise<IpcResult<RunRecord>> =>
      ipcRenderer.invoke(IPC_CHANNEL.RUNS_CONTINUE, request),
    acknowledgeGuardrail: (request: AcknowledgeGuardrailRequest): Promise<IpcResult<RunRecord>> =>
      ipcRenderer.invoke(IPC_CHANNEL.RUNS_ACKNOWLEDGE_GUARDRAIL, request),
    escalate: (request: EscalateRunRequest): Promise<IpcResult<RunRecord>> =>
      ipcRenderer.invoke(IPC_CHANNEL.RUNS_ESCALATE, request),
    onEvent: (listener: (event: RunEvent) => void): (() => void) => {
      // The IpcRendererEvent is deliberately not forwarded: it carries a `sender`
      // the renderer has no business holding, which would leak a way around the
      // typed bridge.
      const handler = (_event: IpcRendererEvent, runEvent: RunEvent): void => listener(runEvent);
      ipcRenderer.on(IPC_EVENT_CHANNEL.RUN_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL.RUN_EVENT, handler);
    },
  },
  models: {
    list: (): Promise<IpcResult<ModelCatalogEntry[]>> =>
      ipcRenderer.invoke(IPC_CHANNEL.MODELS_LIST),
  },
  sandbox: {
    getUsage: (): Promise<IpcResult<SandboxUsage>> => ipcRenderer.invoke(IPC_CHANNEL.SANDBOX_USAGE),
    cleanupTerminal: (): Promise<IpcResult<SandboxUsage>> =>
      ipcRenderer.invoke(IPC_CHANNEL.SANDBOX_CLEANUP),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
