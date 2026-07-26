import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings } from '@shared/settings';
import { queryKeys } from '@renderer/lib/queryKeys';
import { logError } from '@renderer/lib/logError';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

interface UseQuerySettingsResult {
  settings: AppSettings | undefined;
  isSettingsLoading: boolean;
  settingsError: unknown;
}

export function useQuerySettings(): UseQuerySettingsResult {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: async () => unwrapIpcResult(await requireBridge().settings.get()),
  });

  return { settings: data, isSettingsLoading: isLoading, settingsError: error };
}

interface UseExecuteUpdateSettingsResult {
  updateSettings: (patch: Partial<AppSettings>) => void;
  isUpdateSettingsPending: boolean;
}

export function useExecuteUpdateSettings(): UseExecuteUpdateSettingsResult {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async (patch: Partial<AppSettings>) =>
      unwrapIpcResult(await requireBridge().settings.update(patch)),
    onSuccess: (updated) => {
      // Main returns the persisted result, so seeding the cache with it avoids a
      // refetch and cannot drift from what is on disk.
      queryClient.setQueryData(queryKeys.settings(), updated);
    },
    onError: (error) => {
      logError(error, 'useExecuteUpdateSettings');
    },
  });

  return { updateSettings: mutate, isUpdateSettingsPending: isPending };
}
