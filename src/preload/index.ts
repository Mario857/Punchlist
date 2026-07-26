import { contextBridge, ipcRenderer } from 'electron';
import type { PrComment } from '@shared/comments';
import type { GhAuthStatus, LocalRepo, PrListItem, PrRef } from '@shared/discovery';
import type { IpcResult } from '@shared/errors';
import { IPC_CHANNEL, type AirlockApi } from '@shared/ipcContract';
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
};

contextBridge.exposeInMainWorld('electronAPI', api);
