import { useCallback, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import { DEFAULT_COMMENT_FILTERS, type PrComment } from '@shared/comments';
import { useSessionStore } from '@renderer/stores/sessionStore';
import {
  collectAuthorLogins,
  collectCommentPaths,
  summarizeTriage,
} from '../CommentTree/commentTreeModel';

export interface FilterOption {
  value: string;
  label: string;
}

interface UseFilterBarResult {
  isUnresolvedOnly: boolean;
  shouldHideBots: boolean;
  shouldHideOutdated: boolean;
  authorValue: string;
  authorOptions: FilterOption[];
  pathValue: string;
  pathOptions: FilterOption[];
  triageLabel: string;
  hasActiveFilters: boolean;
  onUnresolvedOnlyChange: (isChecked: boolean) => void;
  onHideBotsChange: (isChecked: boolean) => void;
  onHideOutdatedChange: (isChecked: boolean) => void;
  onAuthorChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onPathChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onClearFilters: () => void;
}

/** The empty option value, which stands for "no constraint" rather than a real name. */
const ALL_OPTION_VALUE = '';
const ALL_AUTHORS_LABEL = 'All authors';
const ALL_FILES_LABEL = 'All files';

const TRIAGE_LABEL_JOINER = ' of ';
const TRIAGE_LABEL_SUFFIX = ' decided';

const FIRST_FILTER_INDEX = 0;
const EMPTY_LENGTH = 0;

/**
 * Filters live in the session store, so the arrangement survives a restart, and they
 * are applied over the full fetched set: filtering at fetch time would mean a refetch
 * per toggle and would make the triage counter impossible to compute.
 */
export function useFilterBar(comments: readonly PrComment[]): UseFilterBarResult {
  const filters = useSessionStore((state) => state.filters);
  const setFilters = useSessionStore((state) => state.setFilters);

  const authorOptions = useMemo(
    () => [
      { value: ALL_OPTION_VALUE, label: ALL_AUTHORS_LABEL },
      ...collectAuthorLogins(comments).map((login) => ({ value: login, label: login })),
    ],
    [comments],
  );

  const pathOptions = useMemo(
    () => [
      { value: ALL_OPTION_VALUE, label: ALL_FILES_LABEL },
      ...collectCommentPaths(comments).map((path) => ({ value: path, label: path })),
    ],
    [comments],
  );

  const triage = useMemo(() => summarizeTriage(comments), [comments]);
  const triageLabel = `${triage.decidedCount}${TRIAGE_LABEL_JOINER}${triage.totalCount}${TRIAGE_LABEL_SUFFIX}`;

  const onUnresolvedOnlyChange = useCallback(
    (isChecked: boolean) => setFilters({ ...filters, isUnresolvedOnly: isChecked }),
    [filters, setFilters],
  );

  const onHideBotsChange = useCallback(
    (isChecked: boolean) => setFilters({ ...filters, shouldHideBots: isChecked }),
    [filters, setFilters],
  );

  const onHideOutdatedChange = useCallback(
    (isChecked: boolean) => setFilters({ ...filters, shouldHideOutdated: isChecked }),
    [filters, setFilters],
  );

  const onAuthorChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      setFilters({ ...filters, authors: toFilterValues(event.target.value) }),
    [filters, setFilters],
  );

  const onPathChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      setFilters({ ...filters, paths: toFilterValues(event.target.value) }),
    [filters, setFilters],
  );

  const onClearFilters = useCallback(
    () => setFilters({ ...DEFAULT_COMMENT_FILTERS }),
    [setFilters],
  );

  const hasActiveFilters =
    filters.isUnresolvedOnly ||
    filters.shouldHideBots ||
    filters.shouldHideOutdated ||
    filters.authors.length > EMPTY_LENGTH ||
    filters.paths.length > EMPTY_LENGTH;

  return {
    isUnresolvedOnly: filters.isUnresolvedOnly,
    shouldHideBots: filters.shouldHideBots,
    shouldHideOutdated: filters.shouldHideOutdated,
    authorValue: filters.authors[FIRST_FILTER_INDEX] ?? ALL_OPTION_VALUE,
    authorOptions,
    pathValue: filters.paths[FIRST_FILTER_INDEX] ?? ALL_OPTION_VALUE,
    pathOptions,
    triageLabel,
    hasActiveFilters,
    onUnresolvedOnlyChange,
    onHideBotsChange,
    onHideOutdatedChange,
    onAuthorChange,
    onPathChange,
    onClearFilters,
  };
}

/** The filters are arrays so several values can be added later; the bar picks one. */
function toFilterValues(value: string): string[] {
  if (value === ALL_OPTION_VALUE) return [];
  return [value];
}
