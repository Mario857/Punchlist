import { useQuery } from '@tanstack/react-query';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQueryPrCommentsResult {
  prComments: PrComment[] | undefined;
  isPrCommentsLoading: boolean;
  isPrCommentsFetching: boolean;
  prCommentsError: unknown;
  refetchPrComments: () => void;
}

/**
 * Fetches the full comment set for one PR. Filters are applied in the renderer over
 * this data, never at fetch time: filtering server-side would mean a refetch per
 * toggle and would make a count like "3 of 21 resolved" impossible to compute.
 */
export function useQueryPrComments(ref: PrRef | null): UseQueryPrCommentsResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.prComments(ref?.repoKey ?? '', ref?.number ?? 0),
    queryFn: async () => {
      // The query is disabled without a ref, so this only guards the type.
      if (ref === null) return [];
      return unwrapIpcResult(await requireBridge().comments.fetch(ref));
    },
    enabled: ref !== null,
    refetchOnWindowFocus: false,
  });

  return {
    prComments: data,
    isPrCommentsLoading: isLoading,
    isPrCommentsFetching: isFetching,
    prCommentsError: error,
    refetchPrComments: () => {
      void refetch();
    },
  };
}
