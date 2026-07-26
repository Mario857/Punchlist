/**
 * "gh is not installed" and "your token expired" must not collapse into one
 * generic Error, because the settings screen shows a different remediation for
 * each. The kind is therefore part of the payload and survives IPC.
 */
export const APP_ERROR_KIND = {
  GH_MISSING_BINARY: 'ghMissingBinary',
  GH_UNAUTHENTICATED: 'ghUnauthenticated',
  GH_RATE_LIMITED: 'ghRateLimited',
  GH_NETWORK: 'ghNetwork',
  GH_NO_REPO_ACCESS: 'ghNoRepoAccess',
  GH_MALFORMED_OUTPUT: 'ghMalformedOutput',
  GIT_IDENTITY_UNSET: 'gitIdentityUnset',
  CURSOR_KEY_MISSING: 'cursorKeyMissing',
  AGENT_START_FAILED: 'agentStartFailed',
  WORKTREE_DIRTY: 'worktreeDirty',
  CONFIRMATION_REQUIRED: 'confirmationRequired',
  NOT_FOUND: 'notFound',
  UNKNOWN: 'unknown',
} as const;

export type AppErrorKind = (typeof APP_ERROR_KIND)[keyof typeof APP_ERROR_KIND];

export interface AppErrorPayload {
  kind: AppErrorKind;
  message: string;
  /** The exact command or step that fixes it, when there is one. */
  remediation: string | null;
}

/**
 * Electron flattens a thrown Error across IPC into a string, losing the kind, so
 * handlers return this instead of throwing. The renderer narrows on `ok`.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppErrorPayload };

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly remediation: string | null;

  constructor(kind: AppErrorKind, message: string, remediation: string | null = null) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.remediation = remediation;
  }

  toPayload(): AppErrorPayload {
    return { kind: this.kind, message: this.message, remediation: this.remediation };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toErrorPayload(value: unknown): AppErrorPayload {
  if (isAppError(value)) return value.toPayload();
  const message = value instanceof Error ? value.message : String(value);
  return { kind: APP_ERROR_KIND.UNKNOWN, message, remediation: null };
}
