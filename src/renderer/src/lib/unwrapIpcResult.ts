import { APP_ERROR_KIND, type AppErrorPayload, type IpcResult } from '@shared/errors';

/**
 * Carries the kind and remediation across the IPC boundary into TanStack Query's
 * error state. Handlers in main resolve an IpcResult rather than throwing, because
 * Electron flattens a thrown Error into a string and the kind is exactly what the
 * settings UI needs to tell "gh is not installed" from "your token expired".
 */
export class IpcError extends Error {
  readonly kind: AppErrorPayload['kind'];
  readonly remediation: string | null;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = 'IpcError';
    this.kind = payload.kind;
    this.remediation = payload.remediation;
  }
}

export function isIpcError(value: unknown): value is IpcError {
  return value instanceof IpcError;
}

/**
 * Query and mutation functions signal failure by throwing, so the result union is
 * unwrapped here once instead of at every call site.
 */
export function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok) return result.value;
  throw new IpcError(result.error);
}

/** A missing bridge means preload did not run, which is a wiring bug, not a state to render. */
export function requireBridge(): Window['electronAPI'] {
  const bridge = window.electronAPI;
  if (bridge === undefined) {
    throw new IpcError({
      kind: APP_ERROR_KIND.UNKNOWN,
      message: 'The preload bridge is unavailable, so the app cannot reach the main process.',
      remediation: 'Restart Punchlist. If it persists, rebuild with `bun run build`.',
    });
  }
  return bridge;
}
