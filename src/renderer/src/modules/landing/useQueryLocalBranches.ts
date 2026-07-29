import { useQuery } from '@tanstack/react-query';
import type { PrRef } from '@shared/discovery';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQueryLocalBranchesResult {
  /** Undefined until the first read; the selector renders the stored value alone. */
  localBranches: string[] | undefined;
  isLocalBranchesLoading: boolean;
}

/** The clone's local branches, checked-out branch first — the landing target choices. */
export function useQueryLocalBranches(ref: PrRef | null): UseQueryLocalBranchesResult {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.localBranches(ref?.repoKey ?? ''),
    queryFn: async () => {
      if (ref === null) return [];
      return unwrapIpcResult(await requireBridge().landing.branches(ref));
    },
    enabled: ref !== null,
  });

  return { localBranches: data, isLocalBranchesLoading: isLoading };
}
