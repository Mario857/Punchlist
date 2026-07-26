import {
  APP_ERROR_KIND,
  isAppError,
  type AppErrorKind,
  type AppErrorPayload,
} from '@shared/errors';
import { isDefined } from './guards';

const LOG_PREFIX = '[airlock]';

interface ErrorDetails {
  kind: AppErrorKind | null;
  message: string;
}

function isAppErrorKind(value: unknown): value is AppErrorKind {
  return Object.values(APP_ERROR_KIND).some((kind) => kind === value);
}

/**
 * An AppError thrown in main arrives here as a plain payload rather than an
 * instance — Electron flattens the class across IPC — so the data shape has to be
 * recognised too, and by narrowing rather than casting since it is boundary data.
 */
function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  if (typeof value !== 'object' || value === null) return false;
  if (!('kind' in value) || !('message' in value) || !('remediation' in value)) return false;
  const hasRemediation = value.remediation === null || typeof value.remediation === 'string';
  return isAppErrorKind(value.kind) && typeof value.message === 'string' && hasRemediation;
}

function describeError(error: unknown): ErrorDetails {
  if (isAppError(error)) return { kind: error.kind, message: error.message };
  if (isAppErrorPayload(error)) return { kind: error.kind, message: error.message };
  if (error instanceof Error) return { kind: null, message: error.message };
  return { kind: null, message: String(error) };
}

/**
 * Console only, deliberately: an error value in this app can quote agent
 * transcript text or repository contents, so writing it to a log file would
 * persist sensitive material outside the store the user can inspect and delete.
 */
export function logError(error: unknown, context: string): void {
  const { kind, message } = describeError(error);
  const label = isDefined(kind) ? `${LOG_PREFIX} ${context} [${kind}]` : `${LOG_PREFIX} ${context}`;
  console.error(label, message);
}
