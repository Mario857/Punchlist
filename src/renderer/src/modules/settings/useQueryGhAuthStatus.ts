import { useQuery } from '@tanstack/react-query';
import type { GhAuthStatus } from '@shared/discovery';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQueryGhAuthStatusResult {
  ghAuthStatus: GhAuthStatus | undefined;
  isGhAuthStatusLoading: boolean;
  ghAuthStatusError: unknown;
  refetchGhAuthStatus: () => void;
}

/**
 * The gh preflight: everything in phase 1 depends on it, so it is not retried
 * automatically — an unauthenticated CLI needs the user to run a command, and
 * retrying cannot change that.
 */
export function useQueryGhAuthStatus(): UseQueryGhAuthStatusResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.ghAuthStatus(),
    queryFn: async () => unwrapIpcResult(await requireBridge().gh.getAuthStatus()),
    retry: false,
  });

  return {
    ghAuthStatus: data,
    isGhAuthStatusLoading: isLoading,
    ghAuthStatusError: error,
    refetchGhAuthStatus: () => {
      void refetch();
    },
  };
}
