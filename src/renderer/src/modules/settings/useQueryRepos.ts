import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocalRepo } from '@shared/discovery';
import { logError } from '@renderer/lib/logError';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQueryReposResult {
  repos: LocalRepo[] | undefined;
  isReposLoading: boolean;
  reposError: unknown;
}

export function useQueryRepos(): UseQueryReposResult {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.repos(),
    queryFn: async () => unwrapIpcResult(await requireBridge().repos.list()),
  });

  return { repos: data, isReposLoading: isLoading, reposError: error };
}

interface UseExecuteRepoRegistryResult {
  rescanRepos: () => void;
  addRepoViaPicker: () => void;
  removeRepo: (repoPath: string) => void;
  isRepoRegistryPending: boolean;
}

/**
 * The three registry mutations share one hook because they all resolve to the same
 * new registry list, so they all settle the same cache entry.
 *
 * Discovery is matched against the registry, so a registry change invalidates the
 * discovered PR list too — a newly added clone can turn a not-cloned PR actionable.
 */
export function useExecuteRepoRegistry(): UseExecuteRepoRegistryResult {
  const queryClient = useQueryClient();

  const settleRegistry = (repos: LocalRepo[]): void => {
    queryClient.setQueryData(queryKeys.repos(), repos);
    void queryClient.invalidateQueries({ queryKey: queryKeys.discoveredPrs() });
  };

  const rescan = useMutation({
    mutationFn: async () => unwrapIpcResult(await requireBridge().repos.rescan()),
    onSuccess: settleRegistry,
    onError: (error) => logError(error, 'useExecuteRepoRegistry.rescan'),
  });

  const addViaPicker = useMutation({
    mutationFn: async () => unwrapIpcResult(await requireBridge().repos.addViaPicker()),
    onSuccess: (added) => {
      // Null means the picker was cancelled, which is not a state change.
      if (added === null) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.discoveredPrs() });
    },
    onError: (error) => logError(error, 'useExecuteRepoRegistry.addViaPicker'),
  });

  const remove = useMutation({
    mutationFn: async (repoPath: string) =>
      unwrapIpcResult(await requireBridge().repos.remove(repoPath)),
    onSuccess: settleRegistry,
    onError: (error) => logError(error, 'useExecuteRepoRegistry.remove'),
  });

  const isRepoRegistryPending = rescan.isPending || addViaPicker.isPending || remove.isPending;

  return {
    rescanRepos: rescan.mutate,
    addRepoViaPicker: addViaPicker.mutate,
    removeRepo: remove.mutate,
    isRepoRegistryPending,
  };
}
