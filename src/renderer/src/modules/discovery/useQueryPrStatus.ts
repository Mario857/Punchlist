import { useQuery } from '@tanstack/react-query';
import type { PrStatus } from '@shared/automation';
import type { PrRef } from '@shared/discovery';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQueryPrStatusResult {
  prStatus: PrStatus | undefined;
  isPrStatusLoading: boolean;
  prStatusError: unknown;
}

/**
 * One cheap query for the PR's head, its updatedAt and the branch it is open
 * against. The last is why this exists on the renderer side at all: a landing has to
 * default to the PR's own base, and the search API that populates the picker cannot
 * report it.
 */
export function useQueryPrStatus(ref: PrRef | null): UseQueryPrStatusResult {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.prStatus(ref?.repoKey ?? '', ref?.number ?? 0),
    queryFn: async () => {
      // The query is disabled without a ref; this only satisfies the type.
      if (ref === null) return null;
      return unwrapIpcResult(await requireBridge().prs.status(ref));
    },
    enabled: ref !== null,
  });

  return {
    prStatus: data ?? undefined,
    isPrStatusLoading: isLoading,
    prStatusError: error,
  };
}
