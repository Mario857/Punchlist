import { useEffect, useState } from 'react';
import { AUDIT_ACTION, type AuditAction, type AuditEntry } from '@shared/audit';
import { BADGE_TONE, type BadgeTone } from '@renderer/components/Badge';
import { assertNever } from '@renderer/lib/assertNever';
import { groupBy } from '@renderer/lib/collections';
import { formatDateTime, formatRelativeTime, readNowMs, toElapsedMs } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { logError } from '@renderer/lib/logError';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import type {
  AuditLogEntryItem,
  AuditLogFactItem,
} from '@renderer/modules/audit/AuditLog/components/AuditLogEntry';
import { useQueryAuditLog } from '@renderer/modules/audit/useQueryAuditLog';

export interface AuditLogLandingHeader {
  heading: string;
  /** The tail of the landing id — enough to match two entries by eye. */
  shortLandingId: string;
  /** The full id, for the tooltip and for anything typed into the log file by hand. */
  landingIdTitle: string;
  countLabel: string;
}

export interface AuditLogGroupItem {
  id: string;
  /** Non-null only when these entries were written by one landing. */
  landingHeader: AuditLogLandingHeader | null;
  isLanding: boolean;
  entries: AuditLogEntryItem[];
}

interface UseAuditLogResult {
  heading: string;
  explanation: string;
  countLabel: string;
  groups: AuditLogGroupItem[];
  /** Non-null while the log is loading or empty, neither of which is an error. */
  statusLabel: string | null;
  auditEntriesErrorMessage: string | null;
  isRefreshingAuditEntries: boolean;
  refreshLabel: string;
  onRefreshClick: () => void;
}

const HEADING = 'Audit log';
const EXPLANATION =
  'Everything Punchlist did outside the sandbox — every branch published, push, resolved thread and posted reply — together with the acknowledgements that authorised them. It is append-only: an entry is never edited or removed, and an undo is itself a new entry.';

const LOADING_LABEL = 'Reading the audit log…';
const EMPTY_LABEL =
  'Nothing has left the sandbox yet. Every agent result so far lives only in a throwaway worktree, so there is nothing to report — the first push, resolved thread or posted reply will be recorded here.';

const AUDIT_ENTRIES_ERROR_FALLBACK = 'Could not read the audit log.';

const REFRESH_LABEL = 'Refresh the audit log';

const SINGLE_ENTRY_COUNT_LABEL = '1 entry';
const ENTRY_COUNT_SUFFIX = ' entries';
const NO_COUNT_LABEL = '';

const SINGLE_LANDING_ACTION_LABEL = '1 action in this landing';
const LANDING_ACTION_COUNT_SUFFIX = ' actions in this landing';
const LANDING_HEADING = 'Landing';

const SINGLE_RUN_COUNT_LABEL = '1 run';
const RUN_COUNT_SUFFIX = ' runs';

const REACH_OUTSIDE_LABEL = 'Left the sandbox';
const REACH_AUTHORISATION_LABEL = 'Authorised inside the sandbox';

const PR_FACT_ID = 'pullRequest';
const BRANCH_FACT_ID = 'branch';
const REMOTE_FACT_ID = 'remote';
const THREADS_FACT_ID = 'threads';
const RUNS_FACT_ID = 'runs';

const PR_FACT_LABEL = 'Pull request';
const BRANCH_FACT_LABEL = 'Branch';
const REMOTE_FACT_LABEL = 'Remote';
const THREADS_FACT_LABEL = 'Thread ids';
const RUNS_FACT_LABEL = 'Runs affected';

const PR_NUMBER_PREFIX = ' #';
const ID_SEPARATOR = ', ';

const IS_MONOSPACE = true;
const IS_NOT_MONOSPACE = false;

/** Enough of the landing id to pair two entries by eye without the row being all id. */
const SHORT_LANDING_ID_LENGTH = 8;

const SINGLE_ITEM_COUNT = 1;
const EMPTY_COUNT = 0;

const LANDING_GROUP_PREFIX = 'landing';
const STANDALONE_GROUP_PREFIX = 'entry';
const GROUP_KEY_SEPARATOR = ':';

/** A stable identity, so an unfetched log does not rebuild the list every render. */
const EMPTY_ENTRIES: readonly AuditEntry[] = [];

interface AuditActionPresentation {
  label: string;
  explanation: string;
  tone: BadgeTone;
  /**
   * True for everything that touched the real repo, the remote or GitHub. Only a
   * guardrail acknowledgement is inside the sandbox — it is what authorised a later
   * entry rather than doing anything itself.
   */
  isOutsideSandbox: boolean;
}

/**
 * A `switch` rather than a lookup record so a new `AUDIT_ACTION` member is a compile
 * error here — an unlabelled row in a log whose whole value is completeness would be
 * worse than a failed build.
 */
function toActionPresentation(action: AuditAction): AuditActionPresentation {
  switch (action) {
    case AUDIT_ACTION.GUARDRAIL_ACKNOWLEDGED:
      return {
        label: 'Guardrail acknowledged',
        explanation:
          'You accepted a patch that a guardrail had flagged. Nothing left the sandbox here — this is the decision that allowed a later landing to carry that patch.',
        tone: BADGE_TONE.WARNING,
        isOutsideSandbox: false,
      };
    case AUDIT_ACTION.INTEGRATION_BRANCH_PUBLISHED:
      return {
        label: 'Integration branch published',
        explanation:
          'The integration branch assembled in the sandbox was written into your real repository, so it now exists as a branch you can check out.',
        tone: BADGE_TONE.INFO,
        isOutsideSandbox: true,
      };
    case AUDIT_ACTION.BRANCH_PUSHED:
      return {
        label: 'Branch pushed',
        explanation:
          'The integration branch was pushed to the remote, where everyone with access to the repository can see it. The target branch is never pushed to directly and force-push is never used.',
        tone: BADGE_TONE.ACCENT,
        isOutsideSandbox: true,
      };
    case AUDIT_ACTION.THREAD_RESOLVED:
      return {
        label: 'Threads resolved',
        explanation:
          'Review threads on the pull request were marked resolved on GitHub. The thread ids below are what reopening them again needs.',
        tone: BADGE_TONE.SUCCESS,
        isOutsideSandbox: true,
      };
    case AUDIT_ACTION.THREAD_UNRESOLVED:
      return {
        label: 'Threads reopened',
        explanation:
          'Review threads that had been resolved were reopened on GitHub, which is what undoing a landing does to them.',
        tone: BADGE_TONE.WARNING,
        isOutsideSandbox: true,
      };
    case AUDIT_ACTION.REPLY_POSTED:
      return {
        label: 'Reply posted',
        explanation:
          'A reply was posted on the pull request under your account. A posted comment cannot be unposted — it can only be followed by another one.',
        tone: BADGE_TONE.INFO,
        isOutsideSandbox: true,
      };
    case AUDIT_ACTION.LANDING_UNDONE:
      return {
        label: 'Landing undone',
        explanation:
          'A landing was replayed in reverse: its pushed branch deleted, the threads it resolved reopened, and its runs returned to approved.',
        tone: BADGE_TONE.DANGER,
        isOutsideSandbox: true,
      };
    case AUDIT_ACTION.CONVENTIONS_EXPORTED:
      return {
        label: 'Conventions exported',
        explanation:
          'Distilled conventions were written into a repository, at a path the guardrails otherwise protect against agent writes. This was a deliberate exception you confirmed.',
        tone: BADGE_TONE.INFO,
        isOutsideSandbox: true,
      };
    default:
      return assertNever(action);
  }
}

function toEntryCountLabel(count: number): string {
  if (count === EMPTY_COUNT) return NO_COUNT_LABEL;
  if (count === SINGLE_ITEM_COUNT) return SINGLE_ENTRY_COUNT_LABEL;
  return `${count}${ENTRY_COUNT_SUFFIX}`;
}

function toLandingActionCountLabel(count: number): string {
  if (count === SINGLE_ITEM_COUNT) return SINGLE_LANDING_ACTION_LABEL;
  return `${count}${LANDING_ACTION_COUNT_SUFFIX}`;
}

function toRunCountLabel(count: number): string {
  if (count === SINGLE_ITEM_COUNT) return SINGLE_RUN_COUNT_LABEL;
  return `${count}${RUN_COUNT_SUFFIX}`;
}

/**
 * The ids a fact carries are the ones an action can be traced or reversed by, which is
 * why the branch, the remote and the thread ids are shown rather than summarised. Run
 * ids are internal to the sandbox, so only their count earns a row.
 */
function toFacts(entry: AuditEntry): AuditLogFactItem[] {
  const facts: AuditLogFactItem[] = [];

  if (entry.prRef !== null) {
    facts.push({
      id: PR_FACT_ID,
      label: PR_FACT_LABEL,
      value: `${entry.prRef.repoKey}${PR_NUMBER_PREFIX}${entry.prRef.number}`,
      isMonospace: IS_NOT_MONOSPACE,
    });
  }
  if (entry.branchName !== null) {
    facts.push({
      id: BRANCH_FACT_ID,
      label: BRANCH_FACT_LABEL,
      value: entry.branchName,
      isMonospace: IS_MONOSPACE,
    });
  }
  if (entry.remoteName !== null) {
    facts.push({
      id: REMOTE_FACT_ID,
      label: REMOTE_FACT_LABEL,
      value: entry.remoteName,
      isMonospace: IS_MONOSPACE,
    });
  }
  if (entry.threadIds.length > EMPTY_COUNT) {
    facts.push({
      id: THREADS_FACT_ID,
      label: THREADS_FACT_LABEL,
      value: entry.threadIds.join(ID_SEPARATOR),
      isMonospace: IS_MONOSPACE,
    });
  }
  if (entry.runIds.length > EMPTY_COUNT) {
    facts.push({
      id: RUNS_FACT_ID,
      label: RUNS_FACT_LABEL,
      value: toRunCountLabel(entry.runIds.length),
      isMonospace: IS_NOT_MONOSPACE,
    });
  }

  return facts;
}

function toEntryItem(entry: AuditEntry, nowMs: number): AuditLogEntryItem {
  const presentation = toActionPresentation(entry.action);
  const elapsedMs = toElapsedMs(entry.at, nowMs);
  const facts = toFacts(entry);

  return {
    id: entry.id,
    actionLabel: presentation.label,
    actionExplanation: presentation.explanation,
    actionTone: presentation.tone,
    isActionBadgeMuted: !presentation.isOutsideSandbox,
    isOutsideSandbox: presentation.isOutsideSandbox,
    reachLabel: presentation.isOutsideSandbox ? REACH_OUTSIDE_LABEL : REACH_AUTHORISATION_LABEL,
    summary: entry.summary,
    timestamp: entry.at,
    relativeLabel: formatRelativeTime(elapsedMs),
    absoluteLabel: formatDateTime(entry.at),
    facts,
    hasFacts: facts.length > EMPTY_COUNT,
  };
}

/**
 * Entries without a landing get a key of their own id, so they stay one row each
 * instead of collapsing into a single "no landing" pile.
 */
function toGroupKey(entry: AuditEntry): string {
  if (entry.landingId === null) {
    return `${STANDALONE_GROUP_PREFIX}${GROUP_KEY_SEPARATOR}${entry.id}`;
  }
  return `${LANDING_GROUP_PREFIX}${GROUP_KEY_SEPARATOR}${entry.landingId}`;
}

function toLandingHeader(entries: AuditEntry[]): AuditLogLandingHeader | null {
  // `groupBy` never yields an empty group, and every entry of a group shares the key
  // it was grouped by, so the first entry is what names the group.
  const [firstEntry] = entries;
  const landingId = firstEntry.landingId;
  if (landingId === null) return null;

  return {
    heading: LANDING_HEADING,
    shortLandingId: landingId.slice(-SHORT_LANDING_ID_LENGTH),
    landingIdTitle: landingId,
    countLabel: toLandingActionCountLabel(entries.length),
  };
}

/**
 * The history of what the tool did to your repository, newest first. Entries sharing a
 * `landingId` are grouped rather than interleaved, because "what did that landing do"
 * is the question this view exists to answer — a push, its resolved threads and its
 * posted replies are one act, and reading them as seven unrelated rows loses that.
 *
 * The log is append-only, so there is no control here that changes it. Undo belongs to
 * the landing surface, where the thing being undone is on screen.
 */
export function useAuditLog(): UseAuditLogResult {
  // The clock the relative labels are measured against is state, not a read during
  // render: `Date.now()` in render makes every re-render produce a different label.
  // It is re-read exactly when a refresh is asked for, which is when entries change.
  const [nowMs, setNowMs] = useState(readNowMs);
  const {
    auditEntries,
    isAuditEntriesLoading,
    isAuditEntriesFetching,
    auditEntriesError,
    refetchAuditEntries,
  } = useQueryAuditLog();

  useEffect(() => {
    if (!isDefined(auditEntriesError)) return;
    logError(auditEntriesError, 'useAuditLog.auditEntries');
  }, [auditEntriesError]);

  const entries = auditEntries ?? EMPTY_ENTRIES;

  const groups = [...groupBy(entries, toGroupKey)].map(([groupKey, groupEntries]) => {
    const landingHeader = toLandingHeader(groupEntries);
    return {
      id: groupKey,
      landingHeader,
      isLanding: landingHeader !== null,
      entries: groupEntries.map((entry) => toEntryItem(entry, nowMs)),
    };
  });

  const statusLabel = (() => {
    if (isAuditEntriesLoading) return LOADING_LABEL;
    if (entries.length === EMPTY_COUNT) return EMPTY_LABEL;
    return null;
  })();

  const auditEntriesErrorMessage = (() => {
    if (!isDefined(auditEntriesError)) return null;
    return isIpcError(auditEntriesError) ? auditEntriesError.message : AUDIT_ENTRIES_ERROR_FALLBACK;
  })();

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    countLabel: toEntryCountLabel(entries.length),
    groups,
    statusLabel,
    auditEntriesErrorMessage,
    // A refresh keeps the log on screen; only the very first read has nothing to show.
    isRefreshingAuditEntries: isAuditEntriesFetching && !isAuditEntriesLoading,
    refreshLabel: REFRESH_LABEL,
    onRefreshClick: () => {
      setNowMs(readNowMs());
      refetchAuditEntries();
    },
  };
}
