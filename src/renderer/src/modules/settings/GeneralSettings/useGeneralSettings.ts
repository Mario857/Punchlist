import { useEffect, type ChangeEvent } from 'react';
import { toErrorPayload } from '@shared/errors';
import { DEFAULT_APP_SETTINGS, MAX_CONCURRENCY_CAP, MIN_CONCURRENCY_CAP } from '@shared/settings';
import { isDefined } from '@renderer/lib/guards';
import { logError } from '@renderer/lib/logError';
import { clamp } from '@renderer/lib/numbers';
import {
  useExecuteUpdateSettings,
  useQuerySettings,
} from '@renderer/modules/settings/useQuerySettings';

const DECIMAL_RADIX = 10;
/** Both bounds are selectable, so the inclusive range is one wider than the span. */
const RANGE_INCLUSIVE_OFFSET = 1;

const CONCURRENCY_CAP_OPTIONS: number[] = Array.from(
  { length: MAX_CONCURRENCY_CAP - MIN_CONCURRENCY_CAP + RANGE_INCLUSIVE_OFFSET },
  (_, index) => MIN_CONCURRENCY_CAP + index,
);

interface UseGeneralSettingsResult {
  concurrencyCap: number;
  concurrencyCapOptions: number[];
  shouldRetainWorktrees: boolean;
  hasSettings: boolean;
  isSettingsLoading: boolean;
  settingsErrorMessage: string | null;
  isUpdateSettingsPending: boolean;
  onConcurrencyCapChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onShouldRetainWorktreesChange: (shouldRetainWorktrees: boolean) => void;
}

export function useGeneralSettings(): UseGeneralSettingsResult {
  const { settings, isSettingsLoading, settingsError } = useQuerySettings();
  const { updateSettings, isUpdateSettingsPending } = useExecuteUpdateSettings();

  useEffect(() => {
    if (!isDefined(settingsError)) return;
    logError(settingsError, 'useGeneralSettings');
  }, [settingsError]);

  // While the query is in flight there is no settings object, and the defaults are
  // exactly what main would return for a fresh install. The controls are gated on
  // hasSettings, so this fallback is never the value the user edits.
  const resolvedSettings = settings ?? DEFAULT_APP_SETTINGS;

  const onConcurrencyCapChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const parsed = Number.parseInt(event.target.value, DECIMAL_RADIX);
    if (Number.isNaN(parsed)) return;
    // Clamped rather than trusted: the schema in main rejects an out-of-range cap,
    // and a rejected write would surface as a failure instead of a no-op.
    updateSettings({ concurrencyCap: clamp(parsed, MIN_CONCURRENCY_CAP, MAX_CONCURRENCY_CAP) });
  };

  const onShouldRetainWorktreesChange = (shouldRetainWorktrees: boolean): void => {
    updateSettings({ shouldRetainWorktrees });
  };

  return {
    concurrencyCap: resolvedSettings.concurrencyCap,
    concurrencyCapOptions: CONCURRENCY_CAP_OPTIONS,
    shouldRetainWorktrees: resolvedSettings.shouldRetainWorktrees,
    hasSettings: isDefined(settings),
    isSettingsLoading,
    settingsErrorMessage: isDefined(settingsError) ? toErrorPayload(settingsError).message : null,
    isUpdateSettingsPending,
    onConcurrencyCapChange,
    onShouldRetainWorktreesChange,
  };
}
