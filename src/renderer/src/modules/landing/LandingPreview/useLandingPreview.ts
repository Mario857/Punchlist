import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import type { AssembleLandingRequest, LandingCommitPlan, LandingConflict } from '@shared/landing';
import { keyBy } from '@renderer/lib/collections';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useQueryPrComments } from '@renderer/modules/comments/useQueryPrComments';
import { useExecuteLanding } from '@renderer/modules/landing/useExecuteLanding';
import { useQueryLocalBranches } from '@renderer/modules/landing/useQueryLocalBranches';
import {
  useExecutePushBranch,
  useExecuteResolveThreads,
} from '@renderer/modules/landing/useExecutePublish';
import { useQueryLandingPreview } from '@renderer/modules/landing/useQueryLandingPreview';
import { useExecuteRerunConflicted } from '@renderer/modules/runs/useQueryRuns';
import {
  ASSEMBLE_ERROR_FALLBACK,
  ASSEMBLING_LABEL,
  buildConfirmLabel,
  EMPTY_MERGE_LABEL_SUFFIX,
  buildPushLabel,
  buildPushedLabel,
  buildResolvedLabel,
  RESOLVE_LABEL,
  type LandingPublishView,
  buildConflictPathsLabel,
  buildLandingSuccessLabel,
  COMBINED_DIFF_EMPTY_LABEL,
  COMBINED_DIFF_EXPLANATION,
  COMBINED_DIFF_HEADING,
  COMMENT_LINK_LABEL,
  COMMIT_BODY_LABEL,
  COMMIT_BODY_ROW_COUNT,
  COMMIT_SUBJECT_LABEL,
  COMMITS_ALL_EMPTY_LABEL,
  COMMITS_EMPTY_LABEL,
  COMMITS_EXPLANATION,
  COMMITS_HEADING,
  CONFIRM_EXPLANATION,
  CONFIRM_HEADING,
  CONFLICTS_EXPLANATION,
  CONFLICTS_HEADING,
  LANDING_ERROR_FALLBACK,
  LANDING_EXPLANATION,
  LANDING_FAILURE_AUDIT_NOTICE,
  LANDING_HEADING,
  LANDING_PARTIAL_FAILURE_NOTICE,
  LANDING_PENDING_LABEL,
  LANDING_VIEW_KIND,
  ALL_EMPTY_BLOCKER,
  NOTHING_TO_LAND_BLOCKER,
  NOTHING_TO_PREVIEW_LABEL,
  REASSEMBLE_LABEL,
  RERUN_CONFLICT_LABEL_PREFIX,
  RERUN_CONFLICT_LABEL_SUFFIX,
  RETRY_LABEL,
  TARGET_BRANCH_LABEL,
  TARGET_EXPLANATION,
  TARGET_HEADING,
  TARGET_ITEM_KEY,
  TARGET_PULL_REQUEST_LABEL,
  toCommentSummary,
  type LandingCommitItem,
  type LandingConflictItem,
  type LandingFailureView,
  type LandingView,
} from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

export interface UseLandingPreviewOptions {
  /** Null before a PR is selected: the gate then has nothing to describe. */
  prRef: PrRef | null;
  /** The branch the integration branch is assembled onto. Never pushed to itself. */
  targetBranch: string | null;
}

interface UseLandingPreviewResult {
  heading: string;
  explanation: string;
  view: LandingView;
  /** The selectable targets: local branches, plus the stored value even when stale. */
  branchOptionValues: string[];
}

/** One hand-edited commit message, held only for the runs whose message was touched. */
interface LandingCommitMessageDraft {
  subject: string;
  body: string;
}

/**
 * The confirmation itself, and the only place in the renderer that spells it true. Main
 * mints its type-level `SandboxConfirmation` from this field, so it is set at exactly the
 * step where the user clicked and nowhere a default could carry it.
 */
const IS_CONFIRMED_BY_USER = true;
const PUSH_ERROR_FALLBACK = 'The push failed.';
const RESOLVE_ERROR_FALLBACK = 'Resolving the threads failed.';

function toActionErrorMessage(error: unknown, fallback: string): string | null {
  if (!isDefined(error)) return null;
  return isIpcError(error) ? error.message : fallback;
}

/** Stable identities, so an absent preview does not rebuild every list each render. */
const NO_DRAFTS: ReadonlyMap<string, LandingCommitMessageDraft> = new Map();
const NO_COMMIT_PLANS: readonly LandingCommitPlan[] = [];
const NO_CONFLICTS: readonly LandingConflict[] = [];
const NO_COMMENTS: readonly PrComment[] = [];

const EMPTY_LENGTH = 0;

const PR_NUMBER_PREFIX = ' #';
const COMMIT_FIELD_ID_PREFIX = 'landing-commit-';
const COMMENT_FIELD_ID_SUFFIX = '-comment';
const SUBJECT_FIELD_ID_SUFFIX = '-subject';
const BODY_FIELD_ID_SUFFIX = '-body';

/**
 * The confirmation gate. Every value it renders is derived here, including the reason
 * confirming is unavailable, so the component stays a mapping from state to surface and
 * the rule "nothing runs until the user confirms" is expressed as data rather than as
 * markup that happens to be missing a handler.
 */
export function useLandingPreview({
  prRef,
  targetBranch,
}: UseLandingPreviewOptions): UseLandingPreviewResult {
  // Edits are stored only for the runs whose message was touched, so a re-assembled
  // preview shows the fresh agent summary everywhere the user did not overrule it —
  // and does so without an effect copying data into state.
  const [draftsByRunId, setDraftsByRunId] =
    useState<ReadonlyMap<string, LandingCommitMessageDraft>>(NO_DRAFTS);

  const request: AssembleLandingRequest | null =
    prRef !== null && targetBranch !== null ? { prRef, targetBranch } : null;

  const {
    landingPreview,
    isLandingPreviewLoading,
    isLandingPreviewFetching,
    landingPreviewError,
    refetchLandingPreview,
  } = useQueryLandingPreview(request);
  // Already fetched for the comment tree, so this is a cache read rather than a second
  // round trip; it turns a comment id in the plan into the comment a person recognises.
  const { prComments } = useQueryPrComments(prRef);

  const commentsById = useMemo(
    () => keyBy(isDefined(prComments) ? prComments : NO_COMMENTS, (comment) => comment.id),
    [prComments],
  );

  const commitPlans = isDefined(landingPreview) ? landingPreview.commits : NO_COMMIT_PLANS;
  const conflicts = isDefined(landingPreview) ? landingPreview.conflicts : NO_CONFLICTS;

  /**
   * The plans with the hand-edited messages applied. This array is exactly the shape
   * `ExecuteLandingRequest.commits` takes, so what was read in the preview is what gets
   * committed rather than main re-deriving a message and possibly differing.
   */
  const commits = useMemo<LandingCommitPlan[]>(
    () =>
      commitPlans.map((plan) => {
        const draft = draftsByRunId.get(plan.runId);
        if (draft === undefined) return plan;
        return { ...plan, subject: draft.subject, body: draft.body };
      }),
    [commitPlans, draftsByRunId],
  );

  const commitItems = useMemo<LandingCommitItem[]>(
    () =>
      commits.map((commit) => {
        const summary = toCommentSummary(commit.commentId, commentsById.get(commit.commentId));
        const fieldIdBase = `${COMMIT_FIELD_ID_PREFIX}${commit.runId}`;

        return {
          runId: commit.runId,
          commentLabel: summary.label,
          commentUrl: summary.url,
          commentLinkLabel: COMMENT_LINK_LABEL,
          commentFieldId: `${fieldIdBase}${COMMENT_FIELD_ID_SUFFIX}`,
          subjectFieldId: `${fieldIdBase}${SUBJECT_FIELD_ID_SUFFIX}`,
          subjectLabel: COMMIT_SUBJECT_LABEL,
          subjectValue: commit.subject,
          bodyFieldId: `${fieldIdBase}${BODY_FIELD_ID_SUFFIX}`,
          bodyLabel: COMMIT_BODY_LABEL,
          bodyValue: commit.body,
          bodyRowCount: COMMIT_BODY_ROW_COUNT,
          // The handler closes over the already-merged commit, so the untouched half of
          // the message is carried forward without reading state back out.
          onSubjectChange: (event: ChangeEvent<HTMLInputElement>) => {
            const subject = event.target.value;
            setDraftsByRunId((previous) =>
              new Map(previous).set(commit.runId, { subject, body: commit.body }),
            );
          },
          onBodyChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
            const body = event.target.value;
            setDraftsByRunId((previous) =>
              new Map(previous).set(commit.runId, { subject: commit.subject, body }),
            );
          },
        };
      }),
    [commentsById, commits],
  );

  const { rerunConflicted, isRerunConflictedPending } = useExecuteRerunConflicted();

  const conflictItems = useMemo<LandingConflictItem[]>(
    () =>
      conflicts.map((conflict) => {
        const summary = toCommentSummary(conflict.commentId, commentsById.get(conflict.commentId));
        return {
          runId: conflict.runId,
          commentLabel: summary.label,
          commentUrl: summary.url,
          commentLinkLabel: COMMENT_LINK_LABEL,
          pathsLabel: buildConflictPathsLabel(conflict.paths),
          // Names the comment, because a bare "Re-run" beside several conflicts does
          // not say which one it would start.
          rerunLabel: `${RERUN_CONFLICT_LABEL_PREFIX}${summary.label}${RERUN_CONFLICT_LABEL_SUFFIX}`,
          isRerunPending: isRerunConflictedPending,
          onRerunClick: () => rerunConflicted(conflict.runId),
        };
      }),
    [commentsById, conflicts, isRerunConflictedPending, rerunConflicted],
  );

  const { executeLanding, landingResult, isLandingExecuting, landingError } = useExecuteLanding();
  const { localBranches } = useQueryLocalBranches(prRef);

  // The stored target stays listed even when it no longer exists locally — a selector
  // that silently re-points a landing would be worse than one showing a dead value.
  const branchOptionValues = (() => {
    const options = localBranches ?? [];
    if (targetBranch === null || options.includes(targetBranch)) return options;
    return [targetBranch, ...options];
  })();
  const { pushBranch, pushBranchResult, isPushBranchPending, pushBranchError } =
    useExecutePushBranch();
  const { resolveThreads, resolveThreadsResult, isResolveThreadsPending, resolveThreadsError } =
    useExecuteResolveThreads();

  // The follow-ups exist only once a landing has put commits on the branch: pushing
  // and resolving are their own decisions, taken by their own labelled buttons.
  const publish = ((): LandingPublishView | null => {
    if (!isDefined(landingResult) || prRef === null) return null;
    return {
      pushLabel: buildPushLabel(landingResult.targetBranch),
      isPushPending: isPushBranchPending,
      pushedLabel: isDefined(pushBranchResult)
        ? buildPushedLabel(pushBranchResult.branchName, pushBranchResult.remoteName)
        : null,
      pushErrorMessage: toActionErrorMessage(pushBranchError, PUSH_ERROR_FALLBACK),
      onPushClick: () =>
        pushBranch({
          prRef,
          targetBranch: landingResult.targetBranch,
          isConfirmedByUser: IS_CONFIRMED_BY_USER,
        }),
      resolveLabel: RESOLVE_LABEL,
      isResolvePending: isResolveThreadsPending,
      resolvedLabel: isDefined(resolveThreadsResult)
        ? buildResolvedLabel(resolveThreadsResult.resolvedThreadIds.length)
        : null,
      resolveErrorMessage: toActionErrorMessage(resolveThreadsError, RESOLVE_ERROR_FALLBACK),
      onResolveClick: () => resolveThreads({ prRef, isConfirmedByUser: IS_CONFIRMED_BY_USER }),
    };
  })();

  /**
   * The PR and target come off the assembled preview rather than off the props: what
   * gets landed has to be the artifact that was read, and the preview is the only thing
   * that knows which merges produced it.
   */
  const onConfirmClick = useCallback(() => {
    if (!isDefined(landingPreview)) return;
    executeLanding({
      prRef: landingPreview.prRef,
      targetBranch: landingPreview.targetBranch,
      commits,
      isConfirmedByUser: IS_CONFIRMED_BY_USER,
    });
  }, [commits, executeLanding, landingPreview]);

  // A failed landing is never rendered as though nothing happened: the steps before the
  // one that failed are already real, so the notice and the audit pointer travel with
  // the message rather than being something the reader has to think to ask about.
  const landingFailure = ((): LandingFailureView | null => {
    if (!isDefined(landingError)) return null;
    return {
      message: isIpcError(landingError) ? landingError.message : LANDING_ERROR_FALLBACK,
      remediation: isIpcError(landingError) ? landingError.remediation : null,
      partialWarningLabel: LANDING_PARTIAL_FAILURE_NOTICE,
      auditNoticeLabel: LANDING_FAILURE_AUDIT_NOTICE,
    };
  })();

  const view = ((): LandingView => {
    if (request === null) {
      return {
        kind: LANDING_VIEW_KIND.NOTHING_TO_PREVIEW,
        emptyStateLabel: NOTHING_TO_PREVIEW_LABEL,
      };
    }

    if (isLandingPreviewLoading) {
      return { kind: LANDING_VIEW_KIND.ASSEMBLING, assemblingLabel: ASSEMBLING_LABEL };
    }

    if (isDefined(landingPreviewError)) {
      return {
        kind: LANDING_VIEW_KIND.FAILED,
        errorMessage: isIpcError(landingPreviewError)
          ? landingPreviewError.message
          : ASSEMBLE_ERROR_FALLBACK,
        errorRemediation: isIpcError(landingPreviewError) ? landingPreviewError.remediation : null,
        retryLabel: RETRY_LABEL,
        onRetryClick: refetchLandingPreview,
      };
    }

    if (!isDefined(landingPreview)) {
      return { kind: LANDING_VIEW_KIND.ASSEMBLING, assemblingLabel: ASSEMBLING_LABEL };
    }

    const hasConflicts = conflicts.length > EMPTY_LENGTH;

    // Zero commits has two causes and they need different remedies: nothing approved
    // at all, versus approvals whose work the target branch already has.
    const hasEmptyMerges = landingPreview.emptyMerges.length > EMPTY_LENGTH;
    const blockerLabel = (() => {
      if (commits.length > EMPTY_LENGTH) return null;
      return hasEmptyMerges ? ALL_EMPTY_BLOCKER : NOTHING_TO_LAND_BLOCKER;
    })();

    return {
      kind: LANDING_VIEW_KIND.PREVIEW,
      target: {
        heading: TARGET_HEADING,
        explanation: TARGET_EXPLANATION,
        items: [
          {
            key: TARGET_ITEM_KEY.PULL_REQUEST,
            label: TARGET_PULL_REQUEST_LABEL,
            value: `${landingPreview.prRef.repoKey}${PR_NUMBER_PREFIX}${landingPreview.prRef.number}`,
          },
          {
            key: TARGET_ITEM_KEY.TARGET_BRANCH,
            label: TARGET_BRANCH_LABEL,
            value: landingPreview.targetBranch,
          },
        ],
      },
      // Null rather than an empty card: a conflict section that is usually absent
      // should be absent, and its presence is itself the signal.
      conflicts: hasConflicts
        ? {
            heading: CONFLICTS_HEADING,
            explanation: CONFLICTS_EXPLANATION,
            items: conflictItems,
            reassembleLabel: REASSEMBLE_LABEL,
            isReassembling: isLandingPreviewFetching,
            onReassembleClick: refetchLandingPreview,
          }
        : null,
      commits: {
        emptyMergeItems: landingPreview.emptyMerges.map((empty) => {
          const summary = toCommentSummary(empty.commentId, commentsById.get(empty.commentId));
          return { runId: empty.runId, label: `${summary.label}${EMPTY_MERGE_LABEL_SUFFIX}` };
        }),
        heading: COMMITS_HEADING,
        explanation: COMMITS_EXPLANATION,
        items: commitItems,
        hasCommits: commitItems.length > EMPTY_LENGTH,
        emptyLabel: hasEmptyMerges ? COMMITS_ALL_EMPTY_LABEL : COMMITS_EMPTY_LABEL,
      },
      combinedDiff: {
        heading: COMBINED_DIFF_HEADING,
        explanation: COMBINED_DIFF_EXPLANATION,
        files: landingPreview.combinedFiles,
        hasChanges: landingPreview.combinedFiles.length > EMPTY_LENGTH,
        emptyLabel: COMBINED_DIFF_EMPTY_LABEL,
      },
      // Not offered at all while a conflict stands, which is the difference between a
      // gate and a button someone waits on.
      confirm: hasConflicts
        ? null
        : {
            heading: CONFIRM_HEADING,
            explanation: CONFIRM_EXPLANATION,
            confirmLabel: buildConfirmLabel({
              targetBranch: landingPreview.targetBranch,
              commitCount: commits.length,
            }),
            // A landed preview is stale by definition, and re-clicking would land a
            // second time; the button stays out of reach until this preview is rebuilt.
            isConfirmDisabled: blockerLabel !== null || isDefined(landingResult),
            isConfirmExecuting: isLandingExecuting,
            blockerLabel,
            pendingLabel: isLandingExecuting ? LANDING_PENDING_LABEL : null,
            successLabel: isDefined(landingResult) ? buildLandingSuccessLabel(landingResult) : null,
            failure: landingFailure,
            onConfirmClick,
            publish,
          },
    };
  })();

  return { heading: LANDING_HEADING, explanation: LANDING_EXPLANATION, view, branchOptionValues };
}
