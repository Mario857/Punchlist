import type { ChangeEvent } from 'react';
import type { PrComment } from '@shared/comments';
import { GUARDRAIL_FLAG_KIND, type GuardrailFlagKind } from '@shared/guardrails';
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
}

export interface LandingConflictsView {
  heading: string;
  explanation: string;
  items: LandingConflictItem[];
  reassembleLabel: string;
  isReassembling: boolean;
  onReassembleClick: () => void;
}

export interface LandingConfirmView {
  heading: string;
  confirmLabel: string;
  isConfirmDisabled: boolean;
  /** What still stands in the way; null when nothing but execution itself does. */
  blockerLabel: string | null;
  executionNoticeLabel: string;
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
export const CONFLICT_PATHS_LABEL = 'Conflicting files: ';
export const CONFLICT_PATHS_SEPARATOR = ', ';

export const CONFIRM_HEADING = 'Confirm this landing';
export const CONFIRM_LABEL = 'Land these commits and resolve the listed threads';
export const NOTHING_TO_LAND_BLOCKER =
  'Nothing is approved to land, so there is nothing to confirm.';
export const SINGLE_OUTSTANDING_FLAG_BLOCKER =
  '1 guardrail flag on the combined diff is still unacknowledged.';
export const OUTSTANDING_FLAGS_BLOCKER_SUFFIX =
  ' guardrail flags on the combined diff are still unacknowledged.';

/**
 * The honest line. The gate is finished and the step behind it is not: publishing the
 * integration branch, pushing it, resolving the threads and posting the reply arrive
 * with the close-the-loop phase, and there is no channel on the bridge to invoke.
 */
export const EXECUTION_UNAVAILABLE_NOTICE =
  'Confirming is not wired to anything in this build: the step that publishes the integration branch, pushes it, resolves the threads and posts the reply does not exist yet, so this button stays unavailable rather than pretending to work.';

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
