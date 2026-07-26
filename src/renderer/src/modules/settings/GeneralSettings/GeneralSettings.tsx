import { Card, CARD_PADDING } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { Toggle } from '@renderer/components/Toggle';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { isDefined } from '@renderer/lib/guards';
import { joinClassNames } from '@renderer/lib/classNames';
import { useGeneralSettings } from '@renderer/modules/settings/GeneralSettings/useGeneralSettings';

const CONCURRENCY_CAP_SELECT_ID = 'settings-concurrency-cap';
const RETAIN_WORKTREES_LABEL = 'Retain worktrees after a run ends';

const SELECT_CLASS = joinClassNames(
  'h-9 shrink-0 rounded-md border px-2',
  'text-sm tabular-nums',
  'border-border bg-surface-raised text-ink',
  'hover:border-border-strong',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const SETTING_ROW_CLASS = 'flex items-start justify-between gap-6';
const SETTING_DESCRIPTION_CLASS = 'text-muted mt-1 text-xs leading-relaxed';

export function GeneralSettings() {
  const {
    concurrencyCap,
    concurrencyCapOptions,
    shouldRetainWorktrees,
    hasSettings,
    isSettingsLoading,
    settingsErrorMessage,
    isUpdateSettingsPending,
    onConcurrencyCapChange,
    onShouldRetainWorktreesChange,
  } = useGeneralSettings();

  const concurrencyCapOptionElements = concurrencyCapOptions.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ));

  const body = (() => {
    if (isSettingsLoading) {
      return (
        <p className="text-muted mt-4 flex items-center gap-2 text-sm">
          <Spinner size={SPINNER_SIZE.SM} label="Loading settings" />
          Loading settings…
        </p>
      );
    }

    if (isDefined(settingsErrorMessage)) {
      return (
        <p role="alert" className="text-danger mt-4 text-sm">
          {settingsErrorMessage}
        </p>
      );
    }

    if (!hasSettings) return null;

    return (
      <div className="mt-4 flex flex-col gap-5">
        <div className={SETTING_ROW_CLASS}>
          <div className="min-w-0">
            <label htmlFor={CONCURRENCY_CAP_SELECT_ID} className="text-ink text-sm font-medium">
              Concurrency cap
            </label>
            <p className={SETTING_DESCRIPTION_CLASS}>
              How many agents and git worktrees may exist at once. Raising it finishes a batch
              sooner and costs proportionally more disk, CPU, and model spend.
            </p>
          </div>
          <select
            id={CONCURRENCY_CAP_SELECT_ID}
            value={concurrencyCap}
            disabled={isUpdateSettingsPending}
            onChange={onConcurrencyCapChange}
            className={SELECT_CLASS}
          >
            {concurrencyCapOptionElements}
          </select>
        </div>

        <div className={SETTING_ROW_CLASS}>
          <div className="min-w-0">
            <p className="text-ink text-sm font-medium">Worktree retention</p>
            <p className={SETTING_DESCRIPTION_CLASS}>
              Keeps a worktree on disk once its run reaches a terminal state so you can inspect
              exactly what the agent did. A debug aid: leave it off and Punchlist tears them down.
            </p>
          </div>
          <Toggle
            isChecked={shouldRetainWorktrees}
            onChange={onShouldRetainWorktreesChange}
            label={RETAIN_WORKTREES_LABEL}
            isLabelHidden
            isDisabled={isUpdateSettingsPending}
          />
        </div>
      </div>
    );
  })();

  return (
    <Card padding={CARD_PADDING.LG}>
      <header className="min-w-0">
        <h2 className="text-ink text-sm font-semibold">General</h2>
        <p className="text-muted mt-1 text-xs leading-relaxed">
          Two consequential knobs: how much work runs in parallel, and whether finished sandboxes
          are kept for inspection.
        </p>
      </header>
      {body}
    </Card>
  );
}
