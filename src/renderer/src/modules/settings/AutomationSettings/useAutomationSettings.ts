import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  DEFAULT_WATCHER_POLL_INTERVAL_MS,
  type AutomationSettings as AutomationSettingsModel,
} from '@shared/automation';
import { toErrorPayload } from '@shared/errors';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
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

const EMPTY_COUNT = 0;
const SINGLE_COUNT = 1;

/**
 * A ceiling on a runaway, not a throughput dial: automation starts work while nobody
 * is watching, so the useful range is small on both ends.
 */
const MIN_AUTO_RUNS_PER_HOUR = 1;
const MAX_AUTO_RUNS_PER_HOUR = 12;

const MAX_AUTO_RUNS_PER_HOUR_OPTIONS: number[] = Array.from(
  { length: MAX_AUTO_RUNS_PER_HOUR - MIN_AUTO_RUNS_PER_HOUR + RANGE_INCLUSIVE_OFFSET },
  (_, index) => MIN_AUTO_RUNS_PER_HOUR + index,
);

const MS_PER_SECOND = 1_000;
const POLL_INTERVAL_30_SECONDS_MS = 30_000;
const POLL_INTERVAL_2_MINUTES_MS = 120_000;
const POLL_INTERVAL_5_MINUTES_MS = 300_000;
const POLL_INTERVAL_10_MINUTES_MS = 600_000;

const CUSTOM_POLL_INTERVAL_LABEL_PREFIX = 'Every ';
const CUSTOM_POLL_INTERVAL_LABEL_SUFFIX = ' seconds';

export interface AutomationPollIntervalOption {
  value: number;
  label: string;
}

/** The shipped default is one of the presets, so the list always contains it. */
const POLL_INTERVAL_OPTIONS: readonly AutomationPollIntervalOption[] = [
  { value: POLL_INTERVAL_30_SECONDS_MS, label: 'Every 30 seconds' },
  { value: DEFAULT_WATCHER_POLL_INTERVAL_MS, label: 'Every minute' },
  { value: POLL_INTERVAL_2_MINUTES_MS, label: 'Every 2 minutes' },
  { value: POLL_INTERVAL_5_MINUTES_MS, label: 'Every 5 minutes' },
  { value: POLL_INTERVAL_10_MINUTES_MS, label: 'Every 10 minutes' },
];

/** Commas, spaces, semicolons and newlines all separate; pasting a list should just work. */
const AUTHOR_SEPARATOR_PATTERN = /[\s,;]+/;
const AUTHOR_HANDLE_PREFIX = '@';
const EMPTY_DRAFT = '';

const ENABLED_TOGGLE_LABEL = 'Trigger runs automatically for allowlisted authors';

const AUTOMATION_OFF_SUMMARY_LABEL = 'Off';
const AUTOMATION_ON_NO_AUTHORS_SUMMARY_LABEL = 'On · nobody named';
const AUTOMATION_ON_SINGLE_AUTHOR_SUMMARY_LABEL = 'On · 1 author';
const AUTOMATION_ON_SUMMARY_PREFIX = 'On · ';
const AUTOMATION_ON_SUMMARY_SUFFIX = ' authors';

/**
 * Said as plainly as possible, because the alternative conclusion — that the feature
 * is broken — is the one a silent no-op invites.
 */
const EMPTY_ALLOWLIST_WARNING =
  'Automation is on and no authors are named, so nothing will trigger. An empty allowlist matches nobody rather than everybody: add at least one GitHub login below before this does anything at all.';

export interface AutomationAllowlistEntryModel {
  login: string;
  /** Bound here so the entry markup carries no inline arrow. */
  onRemoveClick: () => void;
}

interface UseAutomationSettingsResult {
  isAutomationEnabled: boolean;
  enabledToggleLabel: string;
  automationSummaryLabel: string;
  allowlistEntries: AutomationAllowlistEntryModel[];
  hasAllowlistEntries: boolean;
  allowlistDraft: string;
  isAddAuthorsDisabled: boolean;
  /** Non-null exactly while automation is enabled against an empty allowlist. */
  emptyAllowlistWarning: string | null;
  maxAutoRunsPerHour: number;
  maxAutoRunsPerHourOptions: number[];
  pollIntervalMs: number;
  pollIntervalOptions: AutomationPollIntervalOption[];
  hasSettings: boolean;
  isSettingsLoading: boolean;
  settingsErrorMessage: string | null;
  isUpdateSettingsPending: boolean;
  onEnabledChange: (isEnabled: boolean) => void;
  onAllowlistDraftChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddAuthorsSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onMaxAutoRunsPerHourChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onPollIntervalChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

/**
 * Forgiving on purpose: `@octocat, hubot` and a pasted column of logins both parse.
 * A leading @ is how GitHub spells a mention and is not part of the login.
 */
function parseAuthorLogins(draft: string): string[] {
  const parsed = draft
    .split(AUTHOR_SEPARATOR_PATTERN)
    .map((part) => part.trim())
    .map((part) =>
      part.startsWith(AUTHOR_HANDLE_PREFIX) ? part.slice(AUTHOR_HANDLE_PREFIX.length) : part,
    )
    .filter((part) => part.length > EMPTY_COUNT);

  const deduped: string[] = [];
  for (const login of parsed) {
    if (containsLogin(deduped, login)) continue;
    deduped.push(login);
  }
  return deduped;
}

/** GitHub logins are case-insensitive, so `Octocat` must not be added beside `octocat`. */
function containsLogin(logins: readonly string[], candidate: string): boolean {
  return logins.some((login) => login.toLowerCase() === candidate.toLowerCase());
}

function buildSummaryLabel(automation: AutomationSettingsModel): string {
  if (!automation.isEnabled) return AUTOMATION_OFF_SUMMARY_LABEL;
  const authorCount = automation.authorAllowlist.length;
  if (authorCount === EMPTY_COUNT) return AUTOMATION_ON_NO_AUTHORS_SUMMARY_LABEL;
  if (authorCount === SINGLE_COUNT) return AUTOMATION_ON_SINGLE_AUTHOR_SUMMARY_LABEL;
  return `${AUTOMATION_ON_SUMMARY_PREFIX}${authorCount}${AUTOMATION_ON_SUMMARY_SUFFIX}`;
}

/**
 * A persisted interval outside the presets — an older build, or a hand-edited store —
 * stays selectable so the control keeps showing the truth instead of silently
 * snapping to a value nobody chose.
 */
function buildPollIntervalOptions(pollIntervalMs: number): AutomationPollIntervalOption[] {
  const isPreset = POLL_INTERVAL_OPTIONS.some((option) => option.value === pollIntervalMs);
  if (isPreset) return [...POLL_INTERVAL_OPTIONS];

  const seconds = Math.round(pollIntervalMs / MS_PER_SECOND);
  const customOption: AutomationPollIntervalOption = {
    value: pollIntervalMs,
    label: `${CUSTOM_POLL_INTERVAL_LABEL_PREFIX}${seconds}${CUSTOM_POLL_INTERVAL_LABEL_SUFFIX}`,
  };
  return [customOption, ...POLL_INTERVAL_OPTIONS];
}

export function useAutomationSettings(): UseAutomationSettingsResult {
  const { settings, isSettingsLoading, settingsError } = useQuerySettings();
  const { updateSettings, isUpdateSettingsPending } = useExecuteUpdateSettings();

  const [allowlistDraft, setAllowlistDraft] = useState(EMPTY_DRAFT);

  useEffect(() => {
    if (!isDefined(settingsError)) return;
    logError(settingsError, 'useAutomationSettings');
  }, [settingsError]);

  // While the query is in flight there is no settings object, and the defaults are
  // exactly what main would return for a fresh install: automation off, nobody named.
  // The controls are gated on hasSettings, so this fallback is never what is edited.
  const automation = settings?.automation ?? DEFAULT_APP_SETTINGS.automation;

  const updateAutomation = (patch: Partial<AutomationSettingsModel>): void => {
    // automation is one nested object in the settings schema, so a change to any field
    // is written as the whole object rather than a partial main would have to merge.
    updateSettings({ automation: { ...automation, ...patch } });
  };

  const onEnabledChange = (isEnabled: boolean): void => {
    updateAutomation({ isEnabled });
  };

  const onAllowlistDraftChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setAllowlistDraft(event.target.value);
  };

  const draftLogins = parseAuthorLogins(allowlistDraft);
  const addableLogins = draftLogins.filter(
    (login) => !containsLogin(automation.authorAllowlist, login),
  );

  const onAddAuthorsSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setAllowlistDraft(EMPTY_DRAFT);
    if (addableLogins.length === EMPTY_COUNT) return;
    updateAutomation({ authorAllowlist: [...automation.authorAllowlist, ...addableLogins] });
  };

  const onRemoveAuthorClick = (login: string): void => {
    updateAutomation({
      authorAllowlist: automation.authorAllowlist.filter((entry) => entry !== login),
    });
  };

  const onMaxAutoRunsPerHourChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const parsed = Number.parseInt(event.target.value, DECIMAL_RADIX);
    if (Number.isNaN(parsed)) return;
    // Clamped rather than trusted: the schema in main rejects a non-positive ceiling,
    // and a rejected write would surface as a failure instead of a no-op.
    updateAutomation({
      maxAutoRunsPerHour: clamp(parsed, MIN_AUTO_RUNS_PER_HOUR, MAX_AUTO_RUNS_PER_HOUR),
    });
  };

  const onPollIntervalChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const parsed = Number.parseInt(event.target.value, DECIMAL_RADIX);
    if (Number.isNaN(parsed)) return;
    updateAutomation({ pollIntervalMs: parsed });
  };

  const allowlistEntries = automation.authorAllowlist.map((login) => ({
    login,
    onRemoveClick: () => onRemoveAuthorClick(login),
  }));

  const isEmptyAllowlistEnabled =
    automation.isEnabled && automation.authorAllowlist.length === EMPTY_COUNT;

  return {
    isAutomationEnabled: automation.isEnabled,
    enabledToggleLabel: ENABLED_TOGGLE_LABEL,
    automationSummaryLabel: buildSummaryLabel(automation),
    allowlistEntries,
    hasAllowlistEntries: allowlistEntries.length > EMPTY_COUNT,
    allowlistDraft,
    isAddAuthorsDisabled:
      addableLogins.length === EMPTY_COUNT || isSettingsLoading || isUpdateSettingsPending,
    emptyAllowlistWarning: isEmptyAllowlistEnabled ? EMPTY_ALLOWLIST_WARNING : null,
    maxAutoRunsPerHour: automation.maxAutoRunsPerHour,
    maxAutoRunsPerHourOptions: MAX_AUTO_RUNS_PER_HOUR_OPTIONS,
    pollIntervalMs: automation.pollIntervalMs,
    pollIntervalOptions: buildPollIntervalOptions(automation.pollIntervalMs),
    hasSettings: isDefined(settings),
    isSettingsLoading,
    settingsErrorMessage: isDefined(settingsError) ? toErrorPayload(settingsError).message : null,
    isUpdateSettingsPending,
    onEnabledChange,
    onAllowlistDraftChange,
    onAddAuthorsSubmit,
    onMaxAutoRunsPerHourChange,
    onPollIntervalChange,
  };
}
