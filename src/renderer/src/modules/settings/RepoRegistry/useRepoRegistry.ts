import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { LocalRepo } from '@shared/discovery';
import { toErrorPayload } from '@shared/errors';
import { isDefined } from '@renderer/lib/guards';
import { logError } from '@renderer/lib/logError';
import { useExecuteRepoRegistry, useQueryRepos } from '@renderer/modules/settings/useQueryRepos';
import {
  useExecuteUpdateSettings,
  useQuerySettings,
} from '@renderer/modules/settings/useQuerySettings';

/** A null draft means the field is showing what is persisted rather than an edit. */
const NO_SCAN_ROOT_DRAFT = null;
const EMPTY_SCAN_ROOT_VALUE = '';
const SINGLE_CLONE_LABEL = '1 clone';

export interface RepoRegistryRowModel {
  repo: LocalRepo;
  onRemoveClick: () => void;
}

interface UseRepoRegistryResult {
  repoRows: RepoRegistryRowModel[];
  hasRepos: boolean;
  repoCountLabel: string;
  isReposLoading: boolean;
  reposErrorMessage: string | null;
  settingsErrorMessage: string | null;
  scanRootValue: string;
  isScanRootSaveDisabled: boolean;
  isUpdateSettingsPending: boolean;
  isRepoRegistryPending: boolean;
  onScanRootChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onScanRootSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRescanClick: () => void;
  onAddRepoClick: () => void;
}

export function useRepoRegistry(): UseRepoRegistryResult {
  const { settings, isSettingsLoading, settingsError } = useQuerySettings();
  const { updateSettings, isUpdateSettingsPending } = useExecuteUpdateSettings();
  const { repos, isReposLoading, reposError } = useQueryRepos();
  const { rescanRepos, addRepoViaPicker, removeRepo, isRepoRegistryPending } =
    useExecuteRepoRegistry();

  const [scanRootDraft, setScanRootDraft] = useState<string | null>(NO_SCAN_ROOT_DRAFT);

  useEffect(() => {
    if (!isDefined(reposError)) return;
    logError(reposError, 'useRepoRegistry.repos');
  }, [reposError]);

  useEffect(() => {
    if (!isDefined(settingsError)) return;
    logError(settingsError, 'useRepoRegistry.settings');
  }, [settingsError]);

  const persistedScanRoot = settings?.repoScanRoot ?? EMPTY_SCAN_ROOT_VALUE;
  // Until the field is touched it shows what is persisted, so a settings load or a
  // change made elsewhere is never masked by stale local state.
  const scanRootValue = scanRootDraft ?? persistedScanRoot;
  const isScanRootDirty = scanRootValue !== persistedScanRoot;

  const onScanRootChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setScanRootDraft(event.target.value);
  };

  const onScanRootSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = scanRootValue.trim();
    // An empty field means "no scan root at all", which the settings schema spells null.
    const nextScanRoot = trimmed.length === 0 ? null : trimmed;
    updateSettings({ repoScanRoot: nextScanRoot });
    // Keeps the trimmed text on screen instead of flashing the old persisted value
    // while the write is in flight; it stops reading as dirty once main confirms.
    setScanRootDraft(trimmed);
  };

  const registeredRepos = repos ?? [];
  const repoRows = registeredRepos.map((repo) => ({
    repo,
    onRemoveClick: () => removeRepo(repo.path),
  }));

  const repoCountLabel =
    registeredRepos.length === 1 ? SINGLE_CLONE_LABEL : `${registeredRepos.length} clones`;

  return {
    repoRows,
    hasRepos: registeredRepos.length > 0,
    repoCountLabel,
    isReposLoading,
    reposErrorMessage: isDefined(reposError) ? toErrorPayload(reposError).message : null,
    settingsErrorMessage: isDefined(settingsError) ? toErrorPayload(settingsError).message : null,
    scanRootValue,
    isScanRootSaveDisabled: !isScanRootDirty || isSettingsLoading || isUpdateSettingsPending,
    isUpdateSettingsPending,
    isRepoRegistryPending,
    onScanRootChange,
    onScanRootSubmit,
    onRescanClick: rescanRepos,
    onAddRepoClick: addRepoViaPicker,
  };
}
