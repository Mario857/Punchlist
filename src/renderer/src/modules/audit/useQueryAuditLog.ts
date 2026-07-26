import { useQuery } from '@tanstack/react-query';
import type { AuditEntry } from '@shared/audit';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQueryAuditLogResult {
  /** Newest first, as main reads them off the log. */
  auditEntries: AuditEntry[] | undefined;
  isAuditEntriesLoading: boolean;
  isAuditEntriesFetching: boolean;
  auditEntriesError: unknown;
  refetchAuditEntries: () => void;
}

/**
 * The log only ever grows, and only main appends to it, so a fetched list can be
 * missing newer entries but is never wrong about the ones it holds. That makes a
 * cached list safe to keep on screen and refetching a matter of asking, not of
 * polling — which is why nothing here refetches on focus or on an interval.
 */
export function useQueryAuditLog(): UseQueryAuditLogResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.auditLog(),
    queryFn: async () => unwrapIpcResult(await requireBridge().audit.list()),
    refetchOnWindowFocus: false,
  });

  return {
    auditEntries: data,
    isAuditEntriesLoading: isLoading,
    isAuditEntriesFetching: isFetching,
    auditEntriesError: error,
    refetchAuditEntries: () => {
      void refetch();
    },
  };
}
