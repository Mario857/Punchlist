import { useMutation, useQuery } from '@tanstack/react-query';
import type { PrListItem } from '@shared/discovery';
import { logError } from '@renderer/lib/logError';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQueryDiscoveredPrsResult {
  discoveredPrs: PrListItem[] | undefined;
  isDiscoveredPrsLoading: boolean;
  isDiscoveredPrsFetching: boolean;
  discoveredPrsError: unknown;
  refetchDiscoveredPrs: () => void;
}

/**
 * GitHub's search API is rate limited more tightly than the regular API, so this
 * refreshes on demand rather than polling: no refetch on window focus, and a stale
 * time long enough that remounting the picker does not spend a search call.
 */
const DISCOVERY_STALE_TIME_MS = 5 * 60 * 1000;

export function useQueryDiscoveredPrs(): UseQueryDiscoveredPrsResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.discoveredPrs(),
    queryFn: async () => unwrapIpcResult(await requireBridge().prs.discover()),
    staleTime: DISCOVERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

  return {
    discoveredPrs: data,
    isDiscoveredPrsLoading: isLoading,
    isDiscoveredPrsFetching: isFetching,
    discoveredPrsError: error,
    refetchDiscoveredPrs: () => {
      void refetch();
    },
  };
}

interface UseExecuteResolvePrUrlResult {
  resolvePrUrl: (url: string) => void;
  resolvedPr: PrListItem | undefined;
  isResolvePrUrlPending: boolean;
  resolvePrUrlError: unknown;
  resetResolvePrUrl: () => void;
}

/** The escape hatch for PRs outside the --author=@me filter. */
export function useExecuteResolvePrUrl(): UseExecuteResolvePrUrlResult {
  const { mutate, data, isPending, error, reset } = useMutation({
    mutationFn: async (url: string) => unwrapIpcResult(await requireBridge().prs.resolveUrl(url)),
    onError: (mutationError) => logError(mutationError, 'useExecuteResolvePrUrl'),
  });

  return {
    resolvePrUrl: mutate,
    resolvedPr: data,
    isResolvePrUrlPending: isPending,
    resolvePrUrlError: error,
    resetResolvePrUrl: reset,
  };
}
