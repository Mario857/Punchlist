import type { ChangeEvent } from 'react';
import type { PrComment } from '@shared/comments';
import { GUARDRAIL_FLAG_KIND, type GuardrailFlagKind } from '@shared/guardrails';
import type { LandingResult } from '@shared/landing';
import type { CandidatePatchFile } from '@shared/runs';
import { buildThreadCountPhrase } from '@renderer/modules/landing/landingCopy';

/**
 * The four states of the gate, as a discriminated union so the pane's branch is a
 * mapping from kind to surface and a new state is a compile error rather than a blank
 * panel where a confirmation used to be.
 */
export const LANDING_VIEW_KIND = {
  NOTHING_TO_PREVIEW: 'nothingToPreview',
  ASSEMBLING: 'assembling',
  FAILED: 'failed',
  PREVIEW: 'preview',
} as const;

export type LandingViewKind = (typeof LANDING_VIEW_KIND)[keyof typeof LANDING_VIEW_KIND];

export interface LandingTargetItem {
  key: string;
  label: string;
  value: string;
}

export interface LandingTargetView {
  heading: string;
  explanation: string;
  items: LandingTargetItem[];
}

export interface LandingCommitItem {
  runId: string;
  /** Which comment this commit resolves, in the author's words rather than by id. */
  commentLabel: string;
  commentUrl: string | null;
  commentLinkLabel: string;
  /** Names the fields below through `aria-describedby`, so "Subject" stays unambiguous. */
  commentFieldId: string;
  subjectFieldId: string;
  subjectLabel: string;
  subjectValue: string;
  bodyFieldId: string;
  bodyLabel: string;
  bodyValue: string;
  bodyRowCount: number;
  onSubjectChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBodyChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}

export interface LandingCommitsView {
  heading: string;
  explanation: string;
  items: LandingCommitItem[];
  hasCommits: boolean;
  emptyLabel: string;
}

export interface LandingCombinedDiffView {
  heading: string;
  explanation: string;
  files: readonly CandidatePatchFile[];
  hasChanges: boolean;
  emptyLabel: string;
}

export interface LandingGuardrailItem {
  id: string;
  kindLabel: string;
  /** Null when the finding is about the combined diff as a whole. */
  path: string | null;
  /** Composed in main and already safe to display — never the matched secret itself. */
  detail: string;
  isAcknowledged: boolean;
  acknowledgedLabel: string;
  /** Names the specific flag, so the button's accessible name identifies which one. */
  acknowledgeLabel: string;
  onAcknowledgeClick: () => void;
}

export interface LandingGuardrailsView {
  heading: string;
  explanation: string;
  items: LandingGuardrailItem[];
  hasFlags: boolean;
  statusLabel: string;
}

export interface LandingThreadItem {
  threadId: string;
  url: string;
}

export interface LandingThreadsView {
  heading: string;
  explanation: string;
  items: LandingThreadItem[];
  hasThreads: boolean;
  emptyLabel: string;
  replyHeading: string;
  /** Null is the default, and it is stated rather than left as a blank section. */
  replyText: string | null;
  noReplyLabel: string;
}

export interface LandingConflictItem {
  runId: string;
  commentLabel: string;
  commentUrl: string | null;
  commentLinkLabel: string;
  pathsLabel: string;
  rerunLabel: string;
  isRerunPending: boolean;
  onRerunClick: () => void;
}

export interface LandingConflictsView {
  heading: string;
  explanation: string;
  items: LandingConflictItem[];
  reassembleLabel: string;
  isReassembling: boolean;
  onReassembleClick: () => void;
}

/**
 * A landing that stopped partway. Rendered instead of a bare error because the steps
 * before the failing one have already taken effect: presenting this as "nothing
 * happened" would be the one lie this screen exists to prevent.
 */
export interface LandingFailureView {
  message: string;
  remediation: string | null;
  partialWarningLabel: string;
  auditNoticeLabel: string;
}

export interface LandingConfirmView {
  heading: string;
  explanation: string;
  /** Names the actual effects — the branch, the remote, the threads, the reply. */
  confirmLabel: string;
  isConfirmDisabled: boolean;
  isConfirmExecuting: boolean;
  /** What still stands in the way; null when nothing does. */
  blockerLabel: string | null;
  /** Non-null only while the sequence is running. */
  pendingLabel: string | null;
  /** Non-null once main has reported what it did. */
  successLabel: string | null;
  failure: LandingFailureView | null;
  onConfirmClick: () => void;
}

/**
 * `confirm` is null exactly when a conflict stands: confirming is then not offered at
 * all rather than offered and refused, which is the difference between a gate and a
 * disabled button someone waits for.
 */
export type LandingView =
  | { kind: typeof LANDING_VIEW_KIND.NOTHING_TO_PREVIEW; emptyStateLabel: string }
  | { kind: typeof LANDING_VIEW_KIND.ASSEMBLING; assemblingLabel: string }
  | {
      kind: typeof LANDING_VIEW_KIND.FAILED;
      errorMessage: string;
      errorRemediation: string | null;
      retryLabel: string;
      onRetryClick: () => void;
    }
  | {
      kind: typeof LANDING_VIEW_KIND.PREVIEW;
      target: LandingTargetView;
      conflicts: LandingConflictsView | null;
      commits: LandingCommitsView;
      guardrails: LandingGuardrailsView;
      combinedDiff: LandingCombinedDiffView;
      threads: LandingThreadsView;
      confirm: LandingConfirmView | null;
    };

export const LANDING_HEADING = 'Landing preview';
export const LANDING_EXPLANATION =
  'This is exactly what confirming would do. It was assembled by actually performing the merges in a sandbox worktree, so nothing below is a prediction and nothing below has touched your repository.';

export const NOTHING_TO_PREVIEW_LABEL =
  'Select a pull request and a target branch to assemble a landing preview.';
export const ASSEMBLING_LABEL = 'Merging the approved branches in a sandbox worktree…';
export const ASSEMBLE_ERROR_FALLBACK = 'Could not assemble the landing preview.';
export const RETRY_LABEL = 'Try assembling again';

export const TARGET_HEADING = 'Where this lands';
export const TARGET_EXPLANATION =
  'The target branch is never pushed to directly. The integration branch is pushed as its own branch, so the result arrives as something you can open as a pull request, and reversing it is deleting a branch rather than rewriting history. Force-push is never used.';
export const TARGET_ITEM_KEY = {
  PULL_REQUEST: 'pullRequest',
  REMOTE: 'remote',
  TARGET_BRANCH: 'targetBranch',
  INTEGRATION_BRANCH: 'integrationBranch',
} as const;
export const TARGET_PULL_REQUEST_LABEL = 'Pull request';
export const TARGET_REMOTE_LABEL = 'Remote';
export const TARGET_BRANCH_LABEL = 'Target branch (never pushed to)';
export const TARGET_INTEGRATION_BRANCH_LABEL = 'Integration branch (pushed as its own branch)';

export const COMMITS_HEADING = 'Commits that will be created';
export const COMMITS_EXPLANATION =
  'One squashed commit per resolved comment. The messages are editable right here because the agent wrote its summary before you hand-edited its patch, and correcting that belongs in the step you are already in rather than a separate one — what you leave in these fields is what gets committed.';
export const COMMITS_EMPTY_LABEL =
  'Nothing is approved to land yet, so this landing would create no commit.';
export const COMMIT_SUBJECT_LABEL = 'Commit subject';
export const COMMIT_BODY_LABEL = 'Commit body';
export const COMMIT_BODY_ROW_COUNT = 3;
export const COMMENT_LINK_LABEL = 'View comment on GitHub';

export const COMBINED_DIFF_HEADING = 'Combined diff';
export const COMBINED_DIFF_EXPLANATION =
  'Everything this landing would change, as one diff rather than as a pile of patches.';
export const COMBINED_DIFF_EMPTY_LABEL =
  'The combined diff is empty, so this landing would change no file.';

export const GUARDRAILS_HEADING = 'Flagged on the combined diff';
export const GUARDRAILS_EXPLANATION =
  'The checks run again over the combined diff, because it is a different artifact from any single patch and can be flagged for something none of them was. These acknowledgements are separate from the per-patch ones and travel with this confirmation.';
export const GUARDRAILS_ALL_ACKNOWLEDGED_LABEL =
  'Every flag on the combined diff is acknowledged, so none of them is holding this landing back.';
export const GUARDRAILS_SINGLE_OUTSTANDING_LABEL =
  '1 flag still to acknowledge before this landing can be confirmed.';
export const GUARDRAILS_OUTSTANDING_SUFFIX =
  ' flags still to acknowledge before this landing can be confirmed.';
export const GUARDRAIL_ACKNOWLEDGED_LABEL = 'Acknowledged';

export const THREADS_HEADING = 'Threads that will be resolved';
export const THREADS_EXPLANATION =
  'Each of these is resolved through the GitHub API when you confirm. They are listed by URL rather than counted, because a count is not something you can check.';
export const THREADS_EMPTY_LABEL = 'No review thread will be resolved by this landing.';
export const REPLY_HEADING = 'Reply comment';
export const NO_REPLY_LABEL =
  'No reply comment will be posted. That is the default, and it is stated rather than left blank because a posted comment cannot be unposted.';

export const CONFLICTS_HEADING = 'Conflicts block this landing';
export const CONFLICTS_EXPLANATION =
  'These squash-merges were really attempted in the sandbox, so each conflict below is a finding rather than a warning — and your repository is untouched. A conflict is resolved by re-running that comment’s agent against the updated integration state, not by hand-merging here: the agent that wrote the patch is the thing that can rewrite it against code that has moved. Confirming is not offered while any of these stands.';
export const REASSEMBLE_LABEL = 'Assemble the preview again';
export const RERUN_CONFLICT_LABEL_PREFIX = 'Re-run ';
export const RERUN_CONFLICT_LABEL_SUFFIX = ' against the integration branch';
export const CONFLICT_PATHS_LABEL = 'Conflicting files: ';
export const CONFLICT_PATHS_SEPARATOR = ', ';

export const CONFIRM_HEADING = 'Confirm this landing';
export const CONFIRM_EXPLANATION =
  'This is the only step that leaves the sandbox. It publishes the integration branch, pushes it, resolves each thread listed above and only then posts the reply — separate network calls, in that order, and not atomic. There is deliberately no keyboard shortcut for this button and it is not focused for you: the gate is worth nothing if it becomes muscle memory.';
export const NOTHING_TO_LAND_BLOCKER =
  'Nothing is approved to land, so there is nothing to confirm.';
export const SINGLE_OUTSTANDING_FLAG_BLOCKER =
  '1 guardrail flag on the combined diff is still unacknowledged.';
export const OUTSTANDING_FLAGS_BLOCKER_SUFFIX =
  ' guardrail flags on the combined diff are still unacknowledged.';

export const LANDING_PENDING_LABEL =
  'Landing… publishing the integration branch, pushing it, resolving each thread and posting the reply. These run one after another, so leave this open until it reports back what it did.';

export const LANDING_ERROR_FALLBACK = 'The landing failed.';

/**
 * The honest line about a partial failure. A landing is a sequence of network calls
 * against a remote and against GitHub, and there is no transaction around them — so the
 * one thing this must never say, by omission or by tone, is that nothing happened.
 */
export const LANDING_PARTIAL_FAILURE_NOTICE =
  'This landing stopped partway. It is not atomic: whatever ran before the step that failed has already taken effect and was not rolled back, so the branch may be pushed and some threads may already be resolved.';
export const LANDING_FAILURE_AUDIT_NOTICE =
  'The audit log records each action as it actually ran, so it — not this message — is what says how far this landing got. If the branch was pushed before the failure, the undo below is what deletes it again.';

/**
 * Landing-local copy on purpose: these name the same kinds the per-patch flags do, but
 * the subject here is the combined diff. The kind-to-label mapping now has a second
 * consumer, so it is a candidate for promotion into a shared place — the per-patch copy
 * lives in `modules/review/GuardrailFlags/useGuardrailFlags.ts`.
 *
 * A Record rather than a lookup with a fallback: adding a guardrail kind becomes a
 * compile error here instead of an unlabelled row the user is asked to accept on trust.
 */
export const LANDING_GUARDRAIL_KIND_LABEL: Record<GuardrailFlagKind, string> = {
  [GUARDRAIL_FLAG_KIND.PROTECTED_PATH]: 'Protected path',
  [GUARDRAIL_FLAG_KIND.SECRET_LIKE]: 'Credential-shaped content',
  [GUARDRAIL_FLAG_KIND.SCOPE_MISMATCH]: 'Larger than the comment asked for',
  [GUARDRAIL_FLAG_KIND.OUT_OF_ANCHOR_PATH]: 'Outside the comment’s file',
};

const ACKNOWLEDGE_PREFIX = 'Acknowledge ';
const ACKNOWLEDGE_PATH_PREFIX = ' on ';
const ACKNOWLEDGE_SUBJECT_SUFFIX = ' on the combined diff';

const COMMENT_EXCERPT_MAX_LENGTH = 80;
const EXCERPT_ELLIPSIS = '…';
const LINE_SEPARATOR = '\n';
const FIRST_LINE_INDEX = 0;
const EXCERPT_START_INDEX = 0;
const EMPTY_LENGTH = 0;
const SINGLE_ITEM_COUNT = 1;
const UNKNOWN_COMMENT_PREFIX = 'Comment ';
const COMMENT_LABEL_SEPARATOR = ' — ';
const EMPTY_BODY_LABEL = '(no comment text)';

export interface LandingCommentSummary {
  label: string;
  url: string | null;
}

function toExcerpt(body: string): string {
  const firstLine = body.split(LINE_SEPARATOR)[FIRST_LINE_INDEX].trim();
  if (firstLine.length === EMPTY_LENGTH) return EMPTY_BODY_LABEL;
  if (firstLine.length <= COMMENT_EXCERPT_MAX_LENGTH) return firstLine;
  return `${firstLine.slice(EXCERPT_START_INDEX, COMMENT_EXCERPT_MAX_LENGTH)}${EXCERPT_ELLIPSIS}`;
}

/**
 * A commit plan and a conflict both carry only a comment id, which says nothing to the
 * person deciding. The fetched comment set is the same one the tree renders, so the
 * lookup is free; a miss falls back to the id rather than to a blank.
 */
export function toCommentSummary(
  commentId: string,
  comment: PrComment | undefined,
): LandingCommentSummary {
  if (comment === undefined) {
    return { label: `${UNKNOWN_COMMENT_PREFIX}${commentId}`, url: null };
  }
  return {
    label: `${comment.author.login}${COMMENT_LABEL_SEPARATOR}${toExcerpt(comment.body)}`,
    url: comment.url,
  };
}

export function buildAcknowledgeLabel(kindLabel: string, path: string | null): string {
  const subject = path === null ? ACKNOWLEDGE_SUBJECT_SUFFIX : `${ACKNOWLEDGE_PATH_PREFIX}${path}`;
  return `${ACKNOWLEDGE_PREFIX}${kindLabel.toLowerCase()}${subject}`;
}

export function buildGuardrailStatusLabel(outstandingCount: number): string {
  if (outstandingCount === EMPTY_LENGTH) return GUARDRAILS_ALL_ACKNOWLEDGED_LABEL;
  if (outstandingCount === SINGLE_ITEM_COUNT) return GUARDRAILS_SINGLE_OUTSTANDING_LABEL;
  return `${outstandingCount}${GUARDRAILS_OUTSTANDING_SUFFIX}`;
}

export function buildOutstandingFlagsBlocker(outstandingCount: number): string {
  if (outstandingCount === SINGLE_ITEM_COUNT) return SINGLE_OUTSTANDING_FLAG_BLOCKER;
  return `${outstandingCount}${OUTSTANDING_FLAGS_BLOCKER_SUFFIX}`;
}

export function buildConflictPathsLabel(paths: readonly string[]): string {
  return `${CONFLICT_PATHS_LABEL}${paths.join(CONFLICT_PATHS_SEPARATOR)}`;
}

const CONFIRM_PUSH_PREFIX = 'Push ';
const CONFIRM_REMOTE_INFIX = ' to ';
const CONFIRM_CLAUSE_SEPARATOR = ', ';
const CONFIRM_FINAL_SEPARATOR = ' and ';
const CONFIRM_RESOLVE_PREFIX = 'resolve ';
const CONFIRM_REPLY_CLAUSE = 'post the reply comment shown above';
const CONFIRM_NO_REPLY_CLAUSE = 'post no reply comment';

export interface LandingEffectSummary {
  integrationBranchName: string;
  remoteName: string;
  threadCount: number;
  isReplyPlanned: boolean;
}

/**
 * The accessible name of the most consequential button in the product. "Confirm" names
 * the gesture and not the effect, so the label is built from what confirming will
 * actually do: which branch goes to which remote, how many threads are resolved, and
 * whether a comment is posted — the one part no undo can take back.
 */
export function buildConfirmLabel(summary: LandingEffectSummary): string {
  const threadsClause = `${CONFIRM_RESOLVE_PREFIX}${buildThreadCountPhrase(summary.threadCount)}`;
  const replyClause = summary.isReplyPlanned ? CONFIRM_REPLY_CLAUSE : CONFIRM_NO_REPLY_CLAUSE;
  return [
    `${CONFIRM_PUSH_PREFIX}${summary.integrationBranchName}`,
    `${CONFIRM_REMOTE_INFIX}${summary.remoteName}`,
    `${CONFIRM_CLAUSE_SEPARATOR}${threadsClause}`,
    `${CONFIRM_FINAL_SEPARATOR}${replyClause}`,
  ].join('');
}

const SUCCESS_PREFIX = 'Landed. ';
const SUCCESS_PUSHED_INFIX = ' is pushed to ';
const SUCCESS_RESOLVED_SUFFIX = ' resolved';
const SUCCESS_REPLY_CLAUSE = 'a reply comment was posted';
const SUCCESS_NO_REPLY_CLAUSE = 'no reply comment was posted';
const SUCCESS_AUDIT_SUFFIX =
  '. Every one of those actions is in the audit log, and the undo below is what reverses the ones that can be reversed.';

/** Reports what main did, from what main returned — never from what was asked for. */
export function buildLandingSuccessLabel(result: LandingResult): string {
  const threadsClause = `${buildThreadCountPhrase(result.resolvedThreadIds.length)}${SUCCESS_RESOLVED_SUFFIX}`;
  const replyClause = result.isReplyPosted ? SUCCESS_REPLY_CLAUSE : SUCCESS_NO_REPLY_CLAUSE;
  return [
    `${SUCCESS_PREFIX}${result.integrationBranchName}`,
    `${SUCCESS_PUSHED_INFIX}${result.remoteName}`,
    `${CONFIRM_CLAUSE_SEPARATOR}${threadsClause}`,
    `${CONFIRM_FINAL_SEPARATOR}${replyClause}`,
    SUCCESS_AUDIT_SUFFIX,
  ].join('');
}
