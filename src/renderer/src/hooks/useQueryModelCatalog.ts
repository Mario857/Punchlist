import { useQuery } from '@tanstack/react-query';
import type { ModelCatalogEntry } from '@shared/models';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

/**
 * Cross-module, hence `hooks/` rather than a feature module: the settings mapping
 * card, the batch start's cost gate, and the frontier escalation menu all read the
 * same catalog. Two module-local copies keyed alike would be one piece of knowledge
 * with two spellings, where whichever mounted first silently decided the fetch
 * behaviour for the others.
 */
interface UseQueryModelCatalogResult {
  modelCatalog: ModelCatalogEntry[] | undefined;
  isModelCatalogLoading: boolean;
  modelCatalogError: unknown;
  refetchModelCatalog: () => void;
}

/**
 * The account's live catalog, read at run time rather than hardcoded because the
 * model list evolves per account. Not retried: a missing or rejected key needs the
 * user to do something, which a retry cannot change.
 *
 * `isEnabled` defaults to true so a caller that has no gating condition — the run
 * side, which only reads the catalog once a run already exists — can omit it.
 */
export function useQueryModelCatalog(isEnabled = true): UseQueryModelCatalogResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.modelCatalog(),
    queryFn: async () => unwrapIpcResult(await requireBridge().models.list()),
    enabled: isEnabled,
    retry: false,
  });

  return {
    modelCatalog: data,
    isModelCatalogLoading: isLoading,
    modelCatalogError: error,
    refetchModelCatalog: () => {
      void refetch();
    },
  };
}

interface UseQueryCursorKeyStatusResult {
  isCursorKeySet: boolean | undefined;
  isCursorKeyStatusLoading: boolean;
  cursorKeyStatusError: unknown;
}

/**
 * Whether a key is stored, never its value: CURSOR_API_KEY is read from safeStorage
 * in main and used in main, so this boolean is the only thing that crosses the
 * bridge. It sits beside the catalog because it is what gates it — `models.list()`
 * needs a stored key.
 */
export function useQueryCursorKeyStatus(): UseQueryCursorKeyStatusResult {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.cursorKeyStatus(),
    queryFn: async () => unwrapIpcResult(await requireBridge().cursorKey.isSet()),
    retry: false,
  });

  return {
    isCursorKeySet: data,
    isCursorKeyStatusLoading: isLoading,
    cursorKeyStatusError: error,
  };
}
