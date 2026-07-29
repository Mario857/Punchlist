import type { DebugTelemetry } from './debug';
import type { PrComment } from './comments';
import type { GhAuthStatus, LocalRepo, PrListItem, PrRef } from './discovery';
import type { AppErrorPayload, IpcResult } from './errors';
import type { PrStatus } from './automation';
import type { AuditEntry } from './audit';
import type {
  ConventionExportPreview,
  ConventionRule,
  ConventionState,
  ExportConventionsRequest,
} from './conventions';
import type {
  AssembleLandingRequest,
  ExecuteLandingRequest,
  PushBranchRequest,
  PushBranchResult,
  ResolveLandedThreadsRequest,
  ResolveLandedThreadsResult,
  LandingPreview,
  LandingResult,
} from './landing';
import type { ModelCatalogEntry } from './models';
import type {
  CandidatePatch,
  ContinueRunRequest,
  EscalateRunRequest,
  RevertRunRequest,
  RunRevision,
  WriteRunFileRequest,
  RunEvent,
  RunRecord,
  SandboxUsage,
  StartRunRequest,
} from './runs';
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
  REPOS_CLONE: 'repos:clone',
  PRS_DISCOVER: 'prs:discover',
  PRS_RESOLVE_URL: 'prs:resolveUrl',
  PRS_STATUS: 'prs:status',
  COMMENTS_FETCH: 'comments:fetch',
  SESSION_GET: 'session:get',
  SESSION_UPDATE: 'session:update',
  CURSOR_KEY_STATUS: 'cursorKey:status',
  CURSOR_KEY_SET: 'cursorKey:set',
  CURSOR_KEY_CLEAR: 'cursorKey:clear',
  RUNS_LIST: 'runs:list',
  RUNS_START: 'runs:start',
  RUNS_CANCEL: 'runs:cancel',
  RUNS_PATCH: 'runs:patch',
  RUNS_DISMISS: 'runs:dismiss',
  RUNS_STOP_ALL: 'runs:stopAll',
  RUNS_ESCALATE: 'runs:escalate',
  RUNS_CONTINUE: 'runs:continue',
  RUNS_REVISIONS: 'runs:revisions',
  RUNS_REVERT: 'runs:revert',
  RUNS_WRITE_FILE: 'runs:writeFile',
  RUNS_SET_AUTO_MODE: 'runs:setAutoMode',
  RUNS_GET_AUTO_MODE: 'runs:getAutoMode',
  RUNS_APPROVE: 'runs:approve',
  RUNS_REJECT: 'runs:reject',
  LANDING_ASSEMBLE: 'landing:assemble',
  LANDING_EXECUTE: 'landing:execute',
  LANDING_BRANCHES: 'landing:branches',
  DEBUG_TELEMETRY: 'debug:telemetry',
  LANDING_PUSH_BRANCH: 'landing:pushBranch',
  LANDING_RESOLVE_THREADS: 'landing:resolveThreads',
  RUNS_RERUN_CONFLICTED: 'runs:rerunConflicted',
  RUNS_SECOND_OPINION: 'runs:secondOpinion',
  AUDIT_LIST: 'audit:list',
  CONVENTIONS_LIST: 'conventions:list',
  CONVENTIONS_DISTILL: 'conventions:distill',
  CONVENTIONS_SET_STATE: 'conventions:setState',
  CONVENTIONS_EXPORT_PREVIEW: 'conventions:exportPreview',
  CONVENTIONS_EXPORT: 'conventions:export',
  MODELS_LIST: 'models:list',
  SANDBOX_USAGE: 'sandbox:usage',
  SANDBOX_CLEANUP: 'sandbox:cleanup',
} as const;

/**
 * Push-only, main → renderer. Separate from the request/response channels above
 * because run progress arrives as a stream, which is why run state lives in a
 * Zustand store rather than the Query cache.
 */
export const IPC_EVENT_CHANNEL = {
  RUN_EVENT: 'runs:event',
} as const;

export type IpcEventChannel = (typeof IPC_EVENT_CHANNEL)[keyof typeof IPC_EVENT_CHANNEL];

export type IpcChannel = (typeof IPC_CHANNEL)[keyof typeof IPC_CHANNEL];

export interface PunchlistVersions {
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
  /**
   * Clones a repository a discovered PR has no local copy of. Explicit rather than
   * implicit: a PR is only actionable once it maps to a repo on disk, but writing a
   * checkout onto someone's filesystem because they clicked a pull request would be
   * the wrong kind of helpful.
   */
  clone(repoKey: string): Promise<IpcResult<LocalRepo[]>>;
}

export interface PrsApi {
  discover(): Promise<IpcResult<PrListItem[]>>;
  /** The URL-paste escape hatch for PRs outside the --author=@me filter. */
  resolveUrl(url: string): Promise<IpcResult<PrListItem>>;
  /**
   * The PR's head, its updatedAt and the branch it is open against. The last is what
   * a landing should default to — not every repository merges into `main`, and the
   * search API cannot report it.
   */
  status(ref: PrRef): Promise<IpcResult<PrStatus>>;
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
  /**
   * Write-only, and the single point where the value crosses the boundary at all.
   * It goes renderer → main once, is encrypted with safeStorage, and never comes
   * back: there is deliberately no getter, so the UI cannot read what it stored.
   */
  set(key: string): Promise<IpcResult<boolean>>;
  clear(): Promise<IpcResult<boolean>>;
}

export interface RunsApi {
  list(ref: PrRef): Promise<IpcResult<RunRecord[]>>;
  start(ref: PrRef, requests: StartRunRequest[]): Promise<IpcResult<RunRecord[]>>;
  cancel(runId: string): Promise<IpcResult<RunRecord>>;
  /** The candidate patch, read from git rather than from any editor buffer. */
  getPatch(runId: string): Promise<IpcResult<CandidatePatch>>;
  /** Tears down a terminal run's worktree and forgets it. */
  dismiss(runId: string): Promise<IpcResult<void>>;
  /** Cancels every active run at once, so a bad batch needs one action, not twelve. */
  stopAll(): Promise<IpcResult<RunRecord[]>>;
  /**
   * Marks runs ready to land. It only ever moves them to approved and never lands
   * anything, which is what keeps bulk approval safe.
   */
  approve(runIds: string[]): Promise<IpcResult<RunRecord[]>>;
  /** Turns resolutions down. The record and its worktree survive until dismissed. */
  reject(runIds: string[]): Promise<IpcResult<RunRecord[]>>;
  /**
   * Asks a fresh agent whether the patch does what the comment asked. It is given
   * the comment and the diff and deliberately not the first agent's reasoning, since
   * that would produce agreement rather than review. Advisory: it never blocks.
   */
  requestSecondOpinion(runIds: string[]): Promise<IpcResult<RunRecord[]>>;
  /**
   * Continues the run's existing agent: the decision reply and the whole-patch
   * follow-up are one mechanism, so context is never rebuilt. Which one it is
   * follows from the run's state rather than a caller-supplied label.
   */
  continueRun(request: ContinueRunRequest): Promise<IpcResult<RunRecord>>;
  /**
   * Writes a hand-edited file back into the worktree and re-reads the patch from
   * git, so the diff cannot desync from what is actually on disk.
   */
  writeFile(request: WriteRunFileRequest): Promise<IpcResult<RunRecord>>;
  /** The worktree's revision trail, newest first. */
  listRevisions(runId: string): Promise<IpcResult<RunRevision[]>>;
  /** Resets the worktree to a revision, discarding every later one. */
  revert(request: RevertRunRequest): Promise<IpcResult<RunRecord>>;
  /**
   * Re-runs a conflicting comment against the integration state its patch must
   * actually apply to. Conflicts are resolved by the agent, not by a merge
   * heuristic — there is already an agent, so it is the one that reconciles.
   */
  rerunConflicted(runId: string): Promise<IpcResult<RunRecord>>;
  /**
   * Records that a guardrail finding was seen and accepted. Flags are not hard
   * blocks — a comment may legitimately ask for a lock-file bump — so the gate is
   * an explicit acknowledgement rather than a refusal.
   */
  /**
   * Retries a hard failure with a fresh agent against the worktree reset to base.
   * `shouldUseFrontier` crosses into the pool-spending lane and is never automatic.
   * A dirty worktree holds unlanded hand-edits that the reset would discard, so it
   * refuses until `isDiscardConfirmed`.
   */
  escalate(request: EscalateRunRequest): Promise<IpcResult<RunRecord>>;
  /**
   * Subscribes to streamed run progress. Returns the unsubscribe function, which
   * the caller must invoke on unmount or listeners accumulate per mount.
   */
  onEvent(listener: (event: RunEvent) => void): () => void;
}

export interface AutoModeApi {
  /**
   * Off on every app start, which is why it is process state in main rather than a
   * persisted setting: it must not be possible to leave it on by accident.
   */
  isEnabled(): Promise<IpcResult<boolean>>;
  setEnabled(isEnabled: boolean): Promise<IpcResult<boolean>>;
}

export interface LandingApi {
  /**
   * Builds the integration result in a sandbox worktree by actually squash-merging
   * each approved branch, so conflicts are found — and can be re-run — while the real
   * repository is still untouched. Nothing here leaves the sandbox.
   */
  assemble(request: AssembleLandingRequest): Promise<IpcResult<LandingPreview>>;
  /**
   * The only path that reaches a real branch. Fast-forwards the local target branch
   * to the assembled result — audited, never forced — and stops there: nothing is
   * pushed, no thread is resolved, no comment is posted.
   */
  execute(request: ExecuteLandingRequest): Promise<IpcResult<LandingResult>>;
  /** The local branches a landing may target, the checked-out branch first. */
  branches(ref: PrRef): Promise<IpcResult<string[]>>;
  /** Pushes the target branch to its remote — on demand, never as part of a landing. */
  pushBranch(request: PushBranchRequest): Promise<IpcResult<PushBranchResult>>;
  /** Resolves the threads of every comment a landed run addressed, skipping resolved ones. */
  resolveThreads(
    request: ResolveLandedThreadsRequest,
  ): Promise<IpcResult<ResolveLandedThreadsResult>>;
}

export interface DebugApi {
  /** A snapshot of this session's counters; reading it changes nothing. */
  telemetry(): Promise<IpcResult<DebugTelemetry>>;
}

export interface ConventionsApi {
  list(): Promise<IpcResult<ConventionRule[]>>;
  /**
   * One free-lane agent over the undistilled evidence. Batched rather than
   * per-comment: a call per comment could not deduplicate, and would emit twenty
   * near-identical naming rules because each call sees one comment.
   */
  distill(): Promise<IpcResult<ConventionRule[]>>;
  /** Confirm, reject or edit. A rejection is remembered so it is never re-proposed. */
  setState(ruleId: string, state: ConventionState): Promise<IpcResult<ConventionRule[]>>;
  previewExport(repoKey: string): Promise<IpcResult<ConventionExportPreview>>;
  /**
   * Writes into the user's real repository, so it is gated and audited like any
   * other action that leaves the sandbox — and recorded as a deliberate exception to
   * the protected-path rule that otherwise guards `.cursor/rules/**`.
   */
  export(request: ExportConventionsRequest): Promise<IpcResult<ConventionRule[]>>;
}

export interface AuditApi {
  /** Append-only and newest-first: the history of what the tool did to your repo. */
  list(): Promise<IpcResult<AuditEntry[]>>;
}

export interface ModelsApi {
  /** The account's live catalog; the tier mapping is chosen from this, never hardcoded. */
  list(): Promise<IpcResult<ModelCatalogEntry[]>>;
}

export interface SandboxApi {
  getUsage(): Promise<IpcResult<SandboxUsage>>;
  /**
   * Removes worktrees for terminal runs only. Never force-removes: a dirty
   * worktree means unlanded hand-edits, so it is reported rather than discarded.
   */
  cleanupTerminal(): Promise<IpcResult<SandboxUsage>>;
}

export interface PunchlistApi {
  platform: string;
  versions: PunchlistVersions;
  gh: GhApi;
  settings: SettingsApi;
  repos: ReposApi;
  prs: PrsApi;
  comments: CommentsApi;
  session: SessionApi;
  cursorKey: CursorKeyApi;
  runs: RunsApi;
  landing: LandingApi;
  conventions: ConventionsApi;
  audit: AuditApi;
  autoMode: AutoModeApi;
  models: ModelsApi;
  sandbox: SandboxApi;
  debug: DebugApi;
}

export type { AppErrorPayload, IpcResult };
