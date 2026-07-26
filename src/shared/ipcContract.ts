import type { PrComment } from './comments';
import type { GhAuthStatus, LocalRepo, PrListItem, PrRef } from './discovery';
import type { AppErrorPayload, IpcResult } from './errors';
import type { AppSettings, SessionState } from './settings';

/**
 * The channel names and the typed bridge shape live in src/shared/ because both
 * processes need them: the preload bridge invokes the channels and src/main/ipc.ts
 * registers them. Putting the strings in main would mean preload imports main at
 * runtime, which would bundle main-process code into the preload script.
 *
 * src/main/ipc.ts remains the single place a channel is bound to an implementation
 * and the only file that calls ipcMain.handle. A component never invokes an
 * ad-hoc channel string.
 */
export const IPC_CHANNEL = {
  GH_AUTH_STATUS: 'gh:authStatus',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  REPOS_LIST: 'repos:list',
  REPOS_RESCAN: 'repos:rescan',
  REPOS_ADD_VIA_PICKER: 'repos:addViaPicker',
  REPOS_REMOVE: 'repos:remove',
  PRS_DISCOVER: 'prs:discover',
  PRS_RESOLVE_URL: 'prs:resolveUrl',
  COMMENTS_FETCH: 'comments:fetch',
  SESSION_GET: 'session:get',
  SESSION_UPDATE: 'session:update',
  CURSOR_KEY_STATUS: 'cursorKey:status',
} as const;

export type IpcChannel = (typeof IPC_CHANNEL)[keyof typeof IPC_CHANNEL];

export interface AirlockVersions {
  electron: string;
  chrome: string;
  node: string;
}

export interface GhApi {
  getAuthStatus(): Promise<IpcResult<GhAuthStatus>>;
}

export interface SettingsApi {
  get(): Promise<IpcResult<AppSettings>>;
  update(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>;
}

export interface ReposApi {
  list(): Promise<IpcResult<LocalRepo[]>>;
  /** Re-scans the configured root for directories containing .git. */
  rescan(): Promise<IpcResult<LocalRepo[]>>;
  /** Opens the native folder picker in main; resolves to null if cancelled. */
  addViaPicker(): Promise<IpcResult<LocalRepo | null>>;
  remove(repoPath: string): Promise<IpcResult<LocalRepo[]>>;
}

export interface PrsApi {
  discover(): Promise<IpcResult<PrListItem[]>>;
  /** The URL-paste escape hatch for PRs outside the --author=@me filter. */
  resolveUrl(url: string): Promise<IpcResult<PrListItem>>;
}

export interface CommentsApi {
  fetch(ref: PrRef): Promise<IpcResult<PrComment[]>>;
}

export interface SessionApi {
  get(): Promise<IpcResult<SessionState>>;
  update(patch: Partial<SessionState>): Promise<IpcResult<SessionState>>;
}

export interface CursorKeyApi {
  /**
   * Whether a key is stored, never its value. CURSOR_API_KEY is read from
   * safeStorage in main and used in main; it does not cross this boundary.
   */
  isSet(): Promise<IpcResult<boolean>>;
}

export interface AirlockApi {
  platform: string;
  versions: AirlockVersions;
  gh: GhApi;
  settings: SettingsApi;
  repos: ReposApi;
  prs: PrsApi;
  comments: CommentsApi;
  session: SessionApi;
  cursorKey: CursorKeyApi;
}

export type { AppErrorPayload, IpcResult };
