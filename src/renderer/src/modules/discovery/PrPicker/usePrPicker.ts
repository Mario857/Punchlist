import { useState, type ChangeEvent, type FormEvent } from 'react';
import { prRefKey, type PrListItem, type PrRef } from '@shared/discovery';
import { formatRelativeTime, readNowMs, toElapsedMs } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import type { PrPickerAlertProps } from '@renderer/modules/discovery/PrPicker/components/PrPickerAlert';
import type { PrPickerRowItem } from '@renderer/modules/discovery/PrPicker/components/PrPickerRow';
import {
  useExecuteCloneRepo,
  useExecuteResolvePrUrl,
  useQueryDiscoveredPrs,
} from '@renderer/modules/discovery/useQueryDiscoveredPrs';

const EMPTY_PR_URL = '';
const EMPTY_LENGTH = 0;
const SINGLE_PR_COUNT = 1;

const PR_NUMBER_PREFIX = '#';
const AUTHOR_LABEL_PREFIX = 'by ';
const UNKNOWN_UPDATED_LABEL = 'updated at an unknown time';
const SINGLE_PR_COUNT_LABEL = '1 open pull request';
const NO_COUNT_LABEL = '';
const REFRESHING_LABEL = 'Refreshing…';
const NO_REFRESH_STATUS_LABEL = '';

const CLONE_LABEL_PREFIX = 'Clone ';
const CLONE_PENDING_NOTICE = 'Cloning takes as long as the repository is large.';
const NOT_CLONED_NOTICE =
  'No local clone found for this repository. A resolution runs in a git worktree, so this PR cannot be selected until the repository is registered in Settings.';

const UNEXPECTED_ERROR_MESSAGE = 'The pull request search failed for an unrecognised reason.';

interface UsePrPickerResult {
  rows: PrPickerRowItem[];
  hasPrRows: boolean;
  isPrListEmpty: boolean;
  countLabel: string;
  isDiscoveredPrsLoading: boolean;
  refreshStatusLabel: string;
  isRefreshingDiscoveredPrs: boolean;
  listAlert: PrPickerAlertProps | null;
  cloneAlert: PrPickerAlertProps | null;
  clonePendingLabel: string | null;
  prUrlValue: string;
  prUrlAlert: PrPickerAlertProps | null;
  resolvedPrRow: PrPickerRowItem | null;
  isResolvePrUrlPending: boolean;
  isPrUrlSubmitDisabled: boolean;
  canClearPrUrl: boolean;
  onRefreshClick: () => void;
  onPrUrlChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPrUrlSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClearPrUrlClick: () => void;
}

function toAlert(error: unknown): PrPickerAlertProps | null {
  if (!isDefined(error)) return null;
  // The kind survives IPC on an IpcError, and with it the remediation the user needs.
  if (isIpcError(error)) return { message: error.message, remediation: error.remediation };
  if (error instanceof Error) return { message: error.message, remediation: null };
  return { message: UNEXPECTED_ERROR_MESSAGE, remediation: null };
}

function toCountLabel(prs: PrListItem[] | undefined): string {
  if (!isDefined(prs)) return NO_COUNT_LABEL;
  if (prs.length === SINGLE_PR_COUNT) return SINGLE_PR_COUNT_LABEL;
  return `${prs.length} open pull requests`;
}

interface RowItemContext {
  nowMs: number;
  selectedPrKey: string | null;
  onSelectPr: (ref: PrRef) => void;
  cloneRepo: (repoKey: string) => void;
  isCloneRepoPending: boolean;
}

function toRowItem(pr: PrListItem, context: RowItemContext): PrPickerRowItem {
  const { nowMs, selectedPrKey, onSelectPr, cloneRepo, isCloneRepoPending } = context;
  const ref: PrRef = { repoKey: pr.repoKey, number: pr.number };
  const prKey = prRefKey(ref);
  const elapsedMs = toElapsedMs(pr.updatedAt, nowMs);
  const updatedLabel = isDefined(elapsedMs) ? formatRelativeTime(elapsedMs) : UNKNOWN_UPDATED_LABEL;
  const hasLocalClone = isDefined(pr.localRepoPath);

  return {
    prKey,
    repoKey: pr.repoKey,
    numberLabel: `${PR_NUMBER_PREFIX}${pr.number}`,
    title: pr.title,
    authorLabel: `${AUTHOR_LABEL_PREFIX}${pr.author}`,
    updatedLabel,
    updatedTitle: pr.updatedAt,
    isDraft: pr.isDraft,
    isSelected: prKey === selectedPrKey,
    onSelect: hasLocalClone ? () => onSelectPr(ref) : null,
    notClonedNotice: hasLocalClone ? null : NOT_CLONED_NOTICE,
    // Names the repository, because several rows can be missing a clone at once and
    // a bare "Clone" would not say which one it would fetch.
    cloneLabel: hasLocalClone ? null : `${CLONE_LABEL_PREFIX}${pr.repoKey}`,
    isClonePending: isCloneRepoPending,
    onCloneClick: hasLocalClone ? null : () => cloneRepo(pr.repoKey),
  };
}

export function usePrPicker(
  selectedPr: PrRef | null,
  onSelectPr: (ref: PrRef) => void,
): UsePrPickerResult {
  const [prUrlValue, setPrUrlValue] = useState(EMPTY_PR_URL);
  // The clock the relative labels are measured against is state, not a read during
  // render: `Date.now()` in render makes every re-render produce a different label.
  // It is re-read exactly when a fetch is triggered, which is when the data changes.
  const [nowMs, setNowMs] = useState(readNowMs);
  const {
    discoveredPrs,
    isDiscoveredPrsLoading,
    isDiscoveredPrsFetching,
    discoveredPrsError,
    refetchDiscoveredPrs,
  } = useQueryDiscoveredPrs();
  const { resolvePrUrl, resolvedPr, isResolvePrUrlPending, resolvePrUrlError, resetResolvePrUrl } =
    useExecuteResolvePrUrl();
  const { cloneRepo, isCloneRepoPending, cloneRepoError } = useExecuteCloneRepo();

  const selectedPrKey = selectedPr === null ? null : prRefKey(selectedPr);
  const rowContext: RowItemContext = {
    nowMs,
    selectedPrKey,
    onSelectPr,
    cloneRepo,
    isCloneRepoPending,
  };
  const rows = (discoveredPrs ?? []).map((pr) => toRowItem(pr, rowContext));
  const resolvedPrRow = isDefined(resolvedPr) ? toRowItem(resolvedPr, rowContext) : null;

  const trimmedPrUrl = prUrlValue.trim();
  const hasPrUrlInput = trimmedPrUrl.length > EMPTY_LENGTH;
  const prUrlAlert = toAlert(resolvePrUrlError);

  // A refresh keeps the list on screen; only the very first fetch has nothing to show.
  const isRefreshingDiscoveredPrs = isDiscoveredPrsFetching && !isDiscoveredPrsLoading;

  return {
    rows,
    hasPrRows: rows.length > EMPTY_LENGTH,
    isPrListEmpty: isDefined(discoveredPrs) && discoveredPrs.length === EMPTY_LENGTH,
    countLabel: toCountLabel(discoveredPrs),
    isDiscoveredPrsLoading,
    refreshStatusLabel: isRefreshingDiscoveredPrs ? REFRESHING_LABEL : NO_REFRESH_STATUS_LABEL,
    isRefreshingDiscoveredPrs,
    listAlert: toAlert(discoveredPrsError),
    cloneAlert: toAlert(cloneRepoError),
    clonePendingLabel: isCloneRepoPending ? CLONE_PENDING_NOTICE : null,
    prUrlValue,
    prUrlAlert,
    resolvedPrRow,
    isResolvePrUrlPending,
    isPrUrlSubmitDisabled: !hasPrUrlInput || isResolvePrUrlPending,
    canClearPrUrl: hasPrUrlInput || resolvedPrRow !== null || prUrlAlert !== null,
    onRefreshClick: () => {
      setNowMs(readNowMs());
      refetchDiscoveredPrs();
    },
    onPrUrlChange: (event: ChangeEvent<HTMLInputElement>) => {
      setPrUrlValue(event.target.value);
    },
    onPrUrlSubmit: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!hasPrUrlInput) return;
      setNowMs(readNowMs());
      resolvePrUrl(trimmedPrUrl);
    },
    onClearPrUrlClick: () => {
      setPrUrlValue(EMPTY_PR_URL);
      resetResolvePrUrl();
    },
  };
}
