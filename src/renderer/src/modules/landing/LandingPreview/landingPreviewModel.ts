import type { ChangeEvent } from 'react';
import type { PrComment } from '@shared/comments';
import type { LandingResult } from '@shared/landing';
import type { CandidatePatchFile } from '@shared/runs';

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
  /**
   * One line per approved run whose merge changed nothing: its work is already on the
   * target branch. Silent omission read as a bug — "Land 0 commits" with no reason —
   * and the usual reason is a stale target branch.
   */
  emptyMergeItems: LandingEmptyMergeItem[];
}

export interface LandingEmptyMergeItem {
  runId: string;
  label: string;
}

export interface LandingCombinedDiffView {
  heading: string;
  explanation: string;
  files: readonly CandidatePatchFile[];
  hasChanges: boolean;
  emptyLabel: string;
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

/**
 * The two follow-ups a local landing leaves open, offered once it has succeeded:
 * pushing the branch, and resolving the threads it addressed. Separate decisions on
 * separate buttons — the landing itself touches nothing beyond the local branch.
 */
export interface LandingPublishView {
  pushLabel: string;
  isPushPending: boolean;
  /** Non-null once main reports the push; the button stays for further pushes. */
  pushedLabel: string | null;
  pushErrorMessage: string | null;
  onPushClick: () => void;
  resolveLabel: string;
  isResolvePending: boolean;
  resolvedLabel: string | null;
  resolveErrorMessage: string | null;
  onResolveClick: () => void;
}

export interface LandingConfirmView {
  heading: string;
  explanation: string;
  /** Names the actual effect: which branch moves, and by how many commits. */
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
  /** Non-null once the landing has succeeded and the follow-ups are worth offering. */
  publish: LandingPublishView | null;
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
      combinedDiff: LandingCombinedDiffView;
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
  'The commits land on this local branch and nowhere else. Nothing is pushed, no thread is resolved, no comment is posted — you publish the result with your own git flow when you are ready. Fast-forward only; force is never used.';
export const TARGET_ITEM_KEY = {
  PULL_REQUEST: 'pullRequest',
  TARGET_BRANCH: 'targetBranch',
} as const;
export const TARGET_PULL_REQUEST_LABEL = 'Pull request';
export const TARGET_BRANCH_LABEL = 'Lands on local branch';

export const COMMITS_HEADING = 'Commits that will be created';
export const COMMITS_EXPLANATION =
  'One squashed commit per resolved comment. The messages are editable right here because the agent wrote its summary before you hand-edited its patch, and correcting that belongs in the step you are already in rather than a separate one — what you leave in these fields is what gets committed.';
export const EMPTY_MERGE_LABEL_SUFFIX =
  ' — already contained in the target branch, so it adds no commit. If that is unexpected, check the target branch above.';
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
  'This is the only step that touches a real branch, and it stays on this machine: the target branch fast-forwards to exactly what is previewed above, and the audit log records the tip it moved from. There is deliberately no keyboard shortcut for this button and it is not focused for you: the gate is worth nothing if it becomes muscle memory.';
export const NOTHING_TO_LAND_BLOCKER =
  'Nothing is approved to land, so there is nothing to confirm.';

export const LANDING_PENDING_LABEL = 'Landing… fast-forwarding the target branch.';

export const LANDING_ERROR_FALLBACK = 'The landing failed.';

/**
 * The honest line about a partial failure. A landing is a sequence of network calls
 * against a remote and against GitHub, and there is no transaction around them — so the
 * one thing this must never say, by omission or by tone, is that nothing happened.
 */
export const LANDING_PARTIAL_FAILURE_NOTICE =
  'This landing stopped partway. Whatever ran before the failing step has already taken effect and was not rolled back — the audit log records exactly what happened, including the tip the branch was on.';
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

export function buildConflictPathsLabel(paths: readonly string[]): string {
  return `${CONFLICT_PATHS_LABEL}${paths.join(CONFLICT_PATHS_SEPARATOR)}`;
}

export interface LandingEffectSummary {
  targetBranch: string;
  commitCount: number;
}

const CONFIRM_LAND_PREFIX = 'Land ';
const CONFIRM_BRANCH_INFIX = ' on ';
const SINGLE_COMMIT_PHRASE = '1 commit';
const COMMIT_PHRASE_SUFFIX = ' commits';

function buildCommitCountPhrase(count: number): string {
  return count === SINGLE_ITEM_COUNT ? SINGLE_COMMIT_PHRASE : `${count}${COMMIT_PHRASE_SUFFIX}`;
}

/**
 * The accessible name of the most consequential button in the product. "Confirm" names
 * the gesture and not the effect, so the label is built from what confirming will
 * actually do: how many commits land on which branch.
 */
export function buildConfirmLabel(summary: LandingEffectSummary): string {
  return `${CONFIRM_LAND_PREFIX}${buildCommitCountPhrase(summary.commitCount)}${CONFIRM_BRANCH_INFIX}${summary.targetBranch}`;
}

const SUCCESS_PREFIX = 'Landed ';
const SUCCESS_BRANCH_INFIX = ' on ';
const SUCCESS_TIP_SUFFIX =
  '. Nothing left this machine — push and resolve the threads below when you are ready, and the audit log records the tip the branch moved from.';

/** Reports what main did, from what main returned — never from what was asked for. */
export function buildLandingSuccessLabel(result: LandingResult): string {
  return `${SUCCESS_PREFIX}${buildCommitCountPhrase(result.commitCount)}${SUCCESS_BRANCH_INFIX}${result.targetBranch}${SUCCESS_TIP_SUFFIX}`;
}

const PUSH_LABEL_PREFIX = 'Push ';
const PUSH_LABEL_SUFFIX = ' to its remote';
const PUSHED_PREFIX = 'Pushed ';
const PUSHED_INFIX = ' to ';
const RESOLVE_THREADS_LABEL = 'Resolve the addressed threads on GitHub';
const RESOLVED_NONE_LABEL =
  'No thread needed resolving — every one a landed run addressed is already resolved.';
const RESOLVED_SINGLE_LABEL = 'Resolved 1 thread.';
const RESOLVED_SUFFIX = ' threads.';
const RESOLVED_PREFIX = 'Resolved ';

export function buildPushLabel(targetBranch: string): string {
  return `${PUSH_LABEL_PREFIX}${targetBranch}${PUSH_LABEL_SUFFIX}`;
}

export function buildPushedLabel(branchName: string, remoteName: string): string {
  return `${PUSHED_PREFIX}${branchName}${PUSHED_INFIX}${remoteName}.`;
}

export const RESOLVE_LABEL = RESOLVE_THREADS_LABEL;

export function buildResolvedLabel(resolvedCount: number): string {
  if (resolvedCount === EMPTY_LENGTH) return RESOLVED_NONE_LABEL;
  if (resolvedCount === SINGLE_ITEM_COUNT) return RESOLVED_SINGLE_LABEL;
  return `${RESOLVED_PREFIX}${resolvedCount}${RESOLVED_SUFFIX}`;
}
