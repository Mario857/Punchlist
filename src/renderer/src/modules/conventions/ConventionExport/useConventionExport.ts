import { useEffect, useState, type ChangeEvent } from 'react';
import { CONVENTION_SCOPE, type ConventionRule } from '@shared/conventions';
import { isDefined } from '@renderer/lib/guards';
import { logError } from '@renderer/lib/logError';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import {
  useExecuteExportConventions,
  useQueryConventionExportPreview,
  useQueryConventions,
} from '@renderer/modules/conventions/useQueryConventions';

export const CONVENTION_EXPORT_VIEW_KIND = {
  NOTHING_TO_EXPORT: 'nothingToExport',
  PREVIEWING: 'previewing',
  FAILED: 'failed',
  PREVIEW: 'preview',
} as const;

export type ConventionExportViewKind =
  (typeof CONVENTION_EXPORT_VIEW_KIND)[keyof typeof CONVENTION_EXPORT_VIEW_KIND];

export interface ConventionExportRepoOption {
  repoKey: string;
  label: string;
}

/** One of the two files, shown as the literal path and the literal bytes. */
export interface ConventionExportFileItem {
  id: string;
  heading: string;
  explanation: string;
  path: string;
  content: string;
  isEmpty: boolean;
  emptyLabel: string;
}

export interface ConventionExportFailureView {
  message: string;
  remediation: string | null;
  partialWarningLabel: string;
  auditNoticeLabel: string;
}

interface ConventionExportNothingView {
  kind: typeof CONVENTION_EXPORT_VIEW_KIND.NOTHING_TO_EXPORT;
  emptyStateLabel: string;
}

interface ConventionExportPreviewingView {
  kind: typeof CONVENTION_EXPORT_VIEW_KIND.PREVIEWING;
  previewingLabel: string;
}

interface ConventionExportFailedView {
  kind: typeof CONVENTION_EXPORT_VIEW_KIND.FAILED;
  errorMessage: string;
  errorRemediation: string | null;
  retryLabel: string;
  onRetryClick: () => void;
}

interface ConventionExportReadyView {
  kind: typeof CONVENTION_EXPORT_VIEW_KIND.PREVIEW;
  files: ConventionExportFileItem[];
  ruleCountLabel: string;
  exportEffectLabel: string;
  /** Names both destinations, because it is the accessible name of the only write here. */
  confirmLabel: string;
  isConfirmDisabled: boolean;
  isConfirmExecuting: boolean;
  blockerLabel: string | null;
  pendingLabel: string | null;
  successLabel: string | null;
  failure: ConventionExportFailureView | null;
  onConfirmClick: () => void;
}

export type ConventionExportView =
  | ConventionExportNothingView
  | ConventionExportPreviewingView
  | ConventionExportFailedView
  | ConventionExportReadyView;

interface UseConventionExportResult {
  heading: string;
  explanation: string;
  /** Says out loud that this write is a recorded exception to a protected path. */
  guardrailNoticeLabel: string;
  repoSelectId: string;
  repoSelectLabel: string;
  repoSelectValue: string;
  repoOptions: ConventionExportRepoOption[];
  hasRepoOptions: boolean;
  noRepoOptionsLabel: string;
  onRepoKeyChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  view: ConventionExportView;
}

const HEADING = 'Export to a repository';
const EXPLANATION =
  'Exporting writes the confirmed rules into your real repository, which puts it outside the punchlist. So it works like a landing: the exact content of both files is rendered by main and shown here first, and nothing is written until you confirm.';
const GUARDRAIL_NOTICE =
  '.cursor/rules/** is on the protected-path list Punchlist enforces against agents resolving your comments, so an agent can never rewrite the guardrails it runs under. This write is the deliberate exception: it is initiated by you from the app rather than by an agent, and it is recorded in the audit log as exactly that rather than quietly bypassing the check.';

const REPO_SELECT_ID = 'convention-export-repo';
const REPO_SELECT_LABEL = 'Repository to export to';
const NO_REPO_OPTIONS_LABEL =
  'No repository-scoped rules yet, so there is no repository to export to. Distil some comments first, then confirm the rules worth keeping.';
const NO_REPO_KEY_VALUE = '';

const NOTHING_TO_EXPORT_LABEL = 'Choose a repository to see exactly what would be written.';
const PREVIEWING_LABEL = 'Rendering both files…';
const RETRY_LABEL = 'Try building the preview again';
const PREVIEW_ERROR_FALLBACK = 'Could not build the export preview.';
const EXPORT_ERROR_FALLBACK = 'The export failed.';

const REPO_FILE_ID = 'repoFile';
const REPO_FILE_HEADING = 'Repository rules file';
const REPO_FILE_EXPLANATION =
  'Written into the repository you selected, where a coding agent working in that clone picks it up as project context.';
const GLOBAL_FILE_ID = 'globalFile';
const GLOBAL_FILE_HEADING = 'User-level rules file';
const GLOBAL_FILE_EXPLANATION =
  'Where the global rules go — a standalone file you reference yourself. Punchlist never edits your own CLAUDE.md in place: that file is yours.';
const EMPTY_FILE_LABEL = 'This file would be written empty, because no confirmed rule targets it.';

const RULE_COUNT_PREFIX = 'Confirmed rules to write: ';
const EXPORT_EFFECT_LABEL =
  'Only confirmed rules are exported — candidates and rejections are left exactly where they are. The rules that are written become exported, and stay in the corpus so a later export rewrites them rather than losing them.';

const CONFIRM_LABEL_PREFIX = 'Write ';
const CONFIRM_LABEL_MIDDLE = ' confirmed rules to ';
const CONFIRM_LABEL_SEPARATOR = ' and to ';
const SINGLE_RULE_CONFIRM_LABEL_PREFIX = 'Write 1 confirmed rule to ';

const NOTHING_CONFIRMED_BLOCKER =
  'No confirmed rules for this repository yet, so nothing would be written. Confirm at least one rule above first.';
const EXPORT_PENDING_LABEL = 'Writing both files…';
const EXPORT_SUCCESS_LABEL =
  'Written. Those rules are marked exported, and the write is in the audit log as a deliberate protected-path exception.';
const EXPORT_PARTIAL_FAILURE_NOTICE =
  'Two files are written in sequence, so a failure here may still have written the first one. Check both paths before retrying.';
const EXPORT_FAILURE_AUDIT_NOTICE = 'Whatever completed before the failure is in the audit log.';

const EMPTY_LENGTH = 0;
const SINGLE_RULE_COUNT = 1;
const FIRST_OPTION_INDEX = 0;
const EMPTY_CONTENT = '';

/**
 * The confirmation itself, and the only place in this module that spells it true. It is
 * set at exactly the step where the user clicked, never carried by a default.
 */
const IS_CONFIRMED_BY_USER = true;

/** A stable identity, so an unfetched corpus does not rebuild the options every render. */
const EMPTY_RULES: readonly ConventionRule[] = [];

/**
 * Every repository that has a rule of its own, sorted so the list does not reshuffle
 * between reads. Global rules deliberately do not add an entry: they are written
 * alongside whichever repository is chosen, never to a repository of their own.
 */
function toRepoOptions(rules: readonly ConventionRule[]): ConventionExportRepoOption[] {
  const repoKeys = new Set<string>();
  for (const rule of rules) {
    if (rule.scope !== CONVENTION_SCOPE.REPO) continue;
    if (rule.repoKey === null) continue;
    repoKeys.add(rule.repoKey);
  }

  return [...repoKeys]
    .sort((first, second) => first.localeCompare(second))
    .map((repoKey) => ({ repoKey, label: repoKey }));
}

function toConfirmLabel(ruleCount: number, repoFilePath: string, globalFilePath: string): string {
  if (ruleCount === SINGLE_RULE_COUNT) {
    return `${SINGLE_RULE_CONFIRM_LABEL_PREFIX}${repoFilePath}${CONFIRM_LABEL_SEPARATOR}${globalFilePath}`;
  }
  return `${CONFIRM_LABEL_PREFIX}${ruleCount}${CONFIRM_LABEL_MIDDLE}${repoFilePath}${CONFIRM_LABEL_SEPARATOR}${globalFilePath}`;
}

/**
 * The export gate. It has the shape of the landing gate for the same reason: this is a
 * write into a real repository, so the preview is the artifact being confirmed and the
 * confirmation is a deliberate click on a button that names both paths.
 *
 * Neither file content nor any rule text is ever passed to `logError` — the content is
 * assembled from rules whose evidence quotes review comments.
 */
export function useConventionExport(): UseConventionExportResult {
  // Held as a draft rather than as the answer: the option it names can disappear when
  // rules change, and deriving the selection keeps that from stranding an empty select.
  const [draftRepoKey, setDraftRepoKey] = useState<string | null>(null);

  const { conventionRules } = useQueryConventions();

  const repoOptions = toRepoOptions(conventionRules ?? EMPTY_RULES);
  const repoKeys = repoOptions.map((option) => option.repoKey);
  const isDraftRepoKeyAvailable = draftRepoKey !== null && repoKeys.includes(draftRepoKey);
  const selectedRepoKey = isDraftRepoKeyAvailable
    ? draftRepoKey
    : (repoKeys.at(FIRST_OPTION_INDEX) ?? null);

  const {
    conventionExportPreview,
    isConventionExportPreviewLoading,
    conventionExportPreviewError,
    refetchConventionExportPreview,
  } = useQueryConventionExportPreview(selectedRepoKey);

  const { exportConventions, exportedRepoKey, isExportConventionsPending, exportConventionsError } =
    useExecuteExportConventions();

  useEffect(() => {
    if (!isDefined(conventionExportPreviewError)) return;
    logError(conventionExportPreviewError, 'useConventionExport.conventionExportPreview');
  }, [conventionExportPreviewError]);

  // An export that failed halfway has still changed the repository, so the notice and
  // the audit pointer travel with the message rather than being something to think to ask.
  const failure = ((): ConventionExportFailureView | null => {
    if (!isDefined(exportConventionsError)) return null;
    return {
      message: isIpcError(exportConventionsError)
        ? exportConventionsError.message
        : EXPORT_ERROR_FALLBACK,
      remediation: isIpcError(exportConventionsError) ? exportConventionsError.remediation : null,
      partialWarningLabel: EXPORT_PARTIAL_FAILURE_NOTICE,
      auditNoticeLabel: EXPORT_FAILURE_AUDIT_NOTICE,
    };
  })();

  const view = ((): ConventionExportView => {
    if (selectedRepoKey === null) {
      return {
        kind: CONVENTION_EXPORT_VIEW_KIND.NOTHING_TO_EXPORT,
        emptyStateLabel: NOTHING_TO_EXPORT_LABEL,
      };
    }

    if (isConventionExportPreviewLoading) {
      return { kind: CONVENTION_EXPORT_VIEW_KIND.PREVIEWING, previewingLabel: PREVIEWING_LABEL };
    }

    if (isDefined(conventionExportPreviewError)) {
      return {
        kind: CONVENTION_EXPORT_VIEW_KIND.FAILED,
        errorMessage: isIpcError(conventionExportPreviewError)
          ? conventionExportPreviewError.message
          : PREVIEW_ERROR_FALLBACK,
        errorRemediation: isIpcError(conventionExportPreviewError)
          ? conventionExportPreviewError.remediation
          : null,
        retryLabel: RETRY_LABEL,
        onRetryClick: refetchConventionExportPreview,
      };
    }

    if (!isDefined(conventionExportPreview)) {
      return { kind: CONVENTION_EXPORT_VIEW_KIND.PREVIEWING, previewingLabel: PREVIEWING_LABEL };
    }

    const preview = conventionExportPreview;
    const blockerLabel = preview.ruleCount === EMPTY_LENGTH ? NOTHING_CONFIRMED_BLOCKER : null;
    // Scoped to the repository that was written, so switching to another one offers its
    // own gate rather than inheriting a success that has nothing to do with it.
    const isExportedForSelectedRepo = exportedRepoKey === selectedRepoKey;

    return {
      kind: CONVENTION_EXPORT_VIEW_KIND.PREVIEW,
      files: [
        {
          id: REPO_FILE_ID,
          heading: REPO_FILE_HEADING,
          explanation: REPO_FILE_EXPLANATION,
          path: preview.repoFilePath,
          content: preview.repoFileContent,
          isEmpty: preview.repoFileContent === EMPTY_CONTENT,
          emptyLabel: EMPTY_FILE_LABEL,
        },
        {
          id: GLOBAL_FILE_ID,
          heading: GLOBAL_FILE_HEADING,
          explanation: GLOBAL_FILE_EXPLANATION,
          path: preview.globalFilePath,
          content: preview.globalFileContent,
          isEmpty: preview.globalFileContent === EMPTY_CONTENT,
          emptyLabel: EMPTY_FILE_LABEL,
        },
      ],
      ruleCountLabel: `${RULE_COUNT_PREFIX}${preview.ruleCount}`,
      exportEffectLabel: EXPORT_EFFECT_LABEL,
      confirmLabel: toConfirmLabel(preview.ruleCount, preview.repoFilePath, preview.globalFilePath),
      // An exported preview is stale by definition, and re-clicking would write a second
      // time; the button stays out of reach until the preview has been rebuilt.
      isConfirmDisabled: blockerLabel !== null || isExportedForSelectedRepo,
      isConfirmExecuting: isExportConventionsPending,
      blockerLabel,
      pendingLabel: isExportConventionsPending ? EXPORT_PENDING_LABEL : null,
      successLabel: isExportedForSelectedRepo ? EXPORT_SUCCESS_LABEL : null,
      failure,
      onConfirmClick: () => {
        exportConventions({ repoKey: selectedRepoKey, isConfirmedByUser: IS_CONFIRMED_BY_USER });
      },
    };
  })();

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    guardrailNoticeLabel: GUARDRAIL_NOTICE,
    repoSelectId: REPO_SELECT_ID,
    repoSelectLabel: REPO_SELECT_LABEL,
    repoSelectValue: selectedRepoKey ?? NO_REPO_KEY_VALUE,
    repoOptions,
    hasRepoOptions: repoOptions.length > EMPTY_LENGTH,
    noRepoOptionsLabel: NO_REPO_OPTIONS_LABEL,
    onRepoKeyChange: (event: ChangeEvent<HTMLSelectElement>) => {
      setDraftRepoKey(event.target.value);
    },
    view,
  };
}
