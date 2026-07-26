import { useEffect, useRef, useState } from 'react';
import {
  APP_ERROR_KIND,
  toErrorPayload,
  type AppErrorKind,
  type AppErrorPayload,
} from '@shared/errors';
import { BADGE_TONE, type BadgeTone } from '@renderer/components/Badge';
import { assertNever } from '@renderer/lib/assertNever';
import { isDefined } from '@renderer/lib/guards';
import { logError } from '@renderer/lib/logError';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useQueryGhAuthStatus } from '@renderer/modules/settings/useQueryGhAuthStatus';

const GH_INSTALL_COMMAND = 'brew install gh';
const GH_LOGIN_COMMAND = 'gh auth login';

const STATUS_LABEL = {
  CHECKING: 'Checking…',
  AUTHENTICATED: 'Authenticated',
  NOT_INSTALLED: 'Not installed',
  NOT_SIGNED_IN: 'Not signed in',
  RATE_LIMITED: 'Rate limited',
  UNREACHABLE: 'Unreachable',
  UNREADABLE: 'Unreadable output',
  NO_ACCESS: 'No repo access',
  CHECK_FAILED: 'Check failed',
} as const;

const COPY_LABEL = 'Copy';
const COPIED_LABEL = 'Copied';
/** Long enough to read the confirmation, short enough that the button re-arms itself. */
const COPIED_FEEDBACK_DURATION_MS = 2000;

const UNKNOWN_VALUE_LABEL = '--';
const SCOPE_SEPARATOR = ', ';
const NO_SCOPES_LABEL = 'none reported';

/**
 * `gh` reports "installed but nobody is logged in" as a successful status object
 * rather than a failure, so that path has no error payload to carry a remediation
 * and states its own.
 */
const UNAUTHENTICATED_MESSAGE =
  'The gh CLI answered, but no account is signed in, so Punchlist cannot read a single pull request.';

interface GhAuthErrorPresentation {
  statusLabel: string;
  title: string;
  tone: BadgeTone;
  /** Used only when the payload itself carries no remediation. */
  fallbackRemediation: string | null;
}

/**
 * The kind picks tone and wording only. The remediation string on the payload wins
 * whenever there is one, because main knows what it actually tried.
 */
function describeErrorKind(kind: AppErrorKind): GhAuthErrorPresentation {
  switch (kind) {
    case APP_ERROR_KIND.GH_MISSING_BINARY:
      return {
        statusLabel: STATUS_LABEL.NOT_INSTALLED,
        title: 'The gh CLI is not installed',
        tone: BADGE_TONE.DANGER,
        fallbackRemediation: GH_INSTALL_COMMAND,
      };
    case APP_ERROR_KIND.GH_UNAUTHENTICATED:
      return {
        statusLabel: STATUS_LABEL.NOT_SIGNED_IN,
        title: 'The gh CLI is not authenticated',
        tone: BADGE_TONE.WARNING,
        fallbackRemediation: GH_LOGIN_COMMAND,
      };
    case APP_ERROR_KIND.GH_RATE_LIMITED:
      return {
        statusLabel: STATUS_LABEL.RATE_LIMITED,
        title: 'GitHub is rate limiting this account',
        tone: BADGE_TONE.WARNING,
        fallbackRemediation: null,
      };
    case APP_ERROR_KIND.GH_NETWORK:
      return {
        statusLabel: STATUS_LABEL.UNREACHABLE,
        title: 'GitHub could not be reached',
        tone: BADGE_TONE.WARNING,
        fallbackRemediation: null,
      };
    case APP_ERROR_KIND.GH_MALFORMED_OUTPUT:
      return {
        statusLabel: STATUS_LABEL.UNREADABLE,
        title: 'gh returned output Punchlist could not parse',
        tone: BADGE_TONE.DANGER,
        fallbackRemediation: null,
      };
    case APP_ERROR_KIND.GH_NO_REPO_ACCESS:
      return {
        statusLabel: STATUS_LABEL.NO_ACCESS,
        title: 'This account cannot see that repository',
        tone: BADGE_TONE.WARNING,
        fallbackRemediation: null,
      };
    case APP_ERROR_KIND.GIT_IDENTITY_UNSET:
    case APP_ERROR_KIND.CURSOR_KEY_MISSING:
    case APP_ERROR_KIND.AGENT_START_FAILED:
    case APP_ERROR_KIND.WORKTREE_DIRTY:
    case APP_ERROR_KIND.CONFIRMATION_REQUIRED:
    case APP_ERROR_KIND.NOT_FOUND:
    case APP_ERROR_KIND.UNKNOWN:
      return {
        statusLabel: STATUS_LABEL.CHECK_FAILED,
        title: 'The gh preflight failed',
        tone: BADGE_TONE.DANGER,
        fallbackRemediation: null,
      };
    default:
      return assertNever(kind);
  }
}

/**
 * IpcError is the renderer-side carrier of an AppErrorPayload, so its kind and
 * remediation survive; anything else arrives with a message and nothing more.
 */
function toAppErrorPayload(error: unknown): AppErrorPayload {
  if (isIpcError(error)) {
    return { kind: error.kind, message: error.message, remediation: error.remediation };
  }
  return toErrorPayload(error);
}

interface GhAuthProblem {
  statusLabel: string;
  title: string;
  message: string;
  tone: BadgeTone;
  remediation: string | null;
}

interface UseGhAuthStatusCardResult {
  isGhAuthStatusLoading: boolean;
  isAuthenticated: boolean;
  statusLabel: string;
  statusTone: BadgeTone;
  loginLabel: string;
  hostLabel: string;
  scopesLabel: string;
  problemTitle: string | null;
  problemMessage: string | null;
  remediation: string | null;
  copyRemediationLabel: string;
  onCopyRemediationClick: () => void;
  onRecheckClick: () => void;
}

export function useGhAuthStatusCard(): UseGhAuthStatusCardResult {
  const { ghAuthStatus, isGhAuthStatusLoading, ghAuthStatusError, refetchGhAuthStatus } =
    useQueryGhAuthStatus();

  const [isRemediationCopied, setIsRemediationCopied] = useState(false);
  const copiedResetHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDefined(ghAuthStatusError)) return;
    logError(ghAuthStatusError, 'useGhAuthStatusCard');
  }, [ghAuthStatusError]);

  useEffect(
    () => () => {
      if (copiedResetHandleRef.current !== null) clearTimeout(copiedResetHandleRef.current);
    },
    [],
  );

  const problem = ((): GhAuthProblem | null => {
    if (isDefined(ghAuthStatusError)) {
      const payload = toAppErrorPayload(ghAuthStatusError);
      const presentation = describeErrorKind(payload.kind);
      return {
        statusLabel: presentation.statusLabel,
        title: presentation.title,
        message: payload.message,
        tone: presentation.tone,
        remediation: payload.remediation ?? presentation.fallbackRemediation,
      };
    }

    if (isDefined(ghAuthStatus) && !ghAuthStatus.isAuthenticated) {
      const presentation = describeErrorKind(APP_ERROR_KIND.GH_UNAUTHENTICATED);
      return {
        statusLabel: presentation.statusLabel,
        title: presentation.title,
        message: UNAUTHENTICATED_MESSAGE,
        tone: presentation.tone,
        remediation: presentation.fallbackRemediation,
      };
    }

    return null;
  })();

  const isAuthenticated = isDefined(ghAuthStatus) && problem === null;

  const statusLabel = (() => {
    if (isGhAuthStatusLoading) return STATUS_LABEL.CHECKING;
    if (problem !== null) return problem.statusLabel;
    if (isAuthenticated) return STATUS_LABEL.AUTHENTICATED;
    return STATUS_LABEL.CHECKING;
  })();

  const statusTone = (() => {
    if (isGhAuthStatusLoading) return BADGE_TONE.NEUTRAL;
    if (problem !== null) return problem.tone;
    if (isAuthenticated) return BADGE_TONE.SUCCESS;
    return BADGE_TONE.NEUTRAL;
  })();

  const scopes = ghAuthStatus?.scopes ?? [];
  const remediation = problem?.remediation ?? null;

  const onCopyRemediationClick = (): void => {
    if (!isDefined(remediation)) return;
    void navigator.clipboard.writeText(remediation).then(
      () => {
        setIsRemediationCopied(true);
        // Re-arms the button, and restarts the window on a second copy rather than
        // letting the first timer cut the confirmation short.
        if (copiedResetHandleRef.current !== null) clearTimeout(copiedResetHandleRef.current);
        copiedResetHandleRef.current = setTimeout(
          () => setIsRemediationCopied(false),
          COPIED_FEEDBACK_DURATION_MS,
        );
      },
      (error: unknown) => logError(error, 'useGhAuthStatusCard.onCopyRemediationClick'),
    );
  };

  return {
    isGhAuthStatusLoading,
    isAuthenticated,
    statusLabel,
    statusTone,
    loginLabel: ghAuthStatus?.login ?? UNKNOWN_VALUE_LABEL,
    hostLabel: ghAuthStatus?.host ?? UNKNOWN_VALUE_LABEL,
    scopesLabel: scopes.length === 0 ? NO_SCOPES_LABEL : scopes.join(SCOPE_SEPARATOR),
    problemTitle: problem?.title ?? null,
    problemMessage: problem?.message ?? null,
    remediation,
    copyRemediationLabel: isRemediationCopied ? COPIED_LABEL : COPY_LABEL,
    onCopyRemediationClick,
    onRecheckClick: refetchGhAuthStatus,
  };
}
