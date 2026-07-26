import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_TYPE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING } from '@renderer/components/Card';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { Toggle } from '@renderer/components/Toggle';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { XIcon } from '@renderer/components/icons/XIcon';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { isDefined } from '@renderer/lib/guards';
import { joinClassNames } from '@renderer/lib/classNames';
import { useAutomationSettings } from '@renderer/modules/settings/AutomationSettings/useAutomationSettings';

const ALLOWLIST_INPUT_ID = 'settings-automation-allowlist';
const MAX_AUTO_RUNS_SELECT_ID = 'settings-automation-max-runs-per-hour';
const POLL_INTERVAL_SELECT_ID = 'settings-automation-poll-interval';

const ALLOWLIST_PLACEHOLDER = 'octocat, hubot';
const ADD_AUTHORS_LABEL = 'Add';
const REMOVE_AUTHOR_LABEL_PREFIX = 'Remove ';
const REMOVE_AUTHOR_LABEL_SUFFIX = ' from the allowlist';

/** Matches the attention glyphs on the run controls, so warnings agree in weight. */
const ATTENTION_ICON_SIZE = 12;
const REMOVE_ICON_SIZE = 11;

const SELECT_CLASS = joinClassNames(
  'h-9 shrink-0 rounded-md border px-2',
  'text-sm tabular-nums',
  'border-border bg-surface-raised text-ink',
  'hover:border-border-strong',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const TEXT_INPUT_CLASS = joinClassNames(
  'h-9 min-w-0 flex-1 rounded-md border px-3',
  'text-sm',
  'border-border bg-surface-raised text-ink placeholder:text-muted/60',
  'hover:border-border-strong',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const SETTING_ROW_CLASS = 'flex items-start justify-between gap-6';
const SETTING_DESCRIPTION_CLASS = 'text-muted mt-1 text-xs leading-relaxed';
const WARNING_CLASS = 'text-warning flex items-start gap-1.5 text-xs leading-relaxed';
const ALLOWLIST_ENTRY_CLASS =
  'border-border/70 bg-surface-raised flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2.5';

export function AutomationSettings() {
  const {
    isAutomationEnabled,
    enabledToggleLabel,
    automationSummaryLabel,
    allowlistEntries,
    hasAllowlistEntries,
    allowlistDraft,
    isAddAuthorsDisabled,
    emptyAllowlistWarning,
    maxAutoRunsPerHour,
    maxAutoRunsPerHourOptions,
    pollIntervalMs,
    pollIntervalOptions,
    hasSettings,
    isSettingsLoading,
    settingsErrorMessage,
    isUpdateSettingsPending,
    onEnabledChange,
    onAllowlistDraftChange,
    onAddAuthorsSubmit,
    onMaxAutoRunsPerHourChange,
    onPollIntervalChange,
  } = useAutomationSettings();

  const maxAutoRunsOptionElements = maxAutoRunsPerHourOptions.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ));

  const pollIntervalOptionElements = pollIntervalOptions.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));

  const allowlistEntryElements = allowlistEntries.map((entry) => (
    <li key={entry.login} className={ALLOWLIST_ENTRY_CLASS}>
      <span className="text-ink text-xs">{entry.login}</span>
      <IconButton
        label={`${REMOVE_AUTHOR_LABEL_PREFIX}${entry.login}${REMOVE_AUTHOR_LABEL_SUFFIX}`}
        icon={<XIcon size={REMOVE_ICON_SIZE} />}
        variant={BUTTON_VARIANT.GHOST}
        size={ICON_BUTTON_SIZE.SM}
        isDisabled={isUpdateSettingsPending}
        onClick={entry.onRemoveClick}
      />
    </li>
  ));

  const allowlistContent = hasAllowlistEntries ? (
    <ul className="mt-3 flex flex-wrap gap-1.5">{allowlistEntryElements}</ul>
  ) : (
    <p className="text-muted/70 mt-3 text-xs">
      Nobody is named yet, so automation has nothing to react to.
    </p>
  );

  const emptyAllowlistNotice = isDefined(emptyAllowlistWarning) ? (
    <p role="alert" className={WARNING_CLASS}>
      <AlertTriangleIcon size={ATTENTION_ICON_SIZE} className="mt-0.5 shrink-0" />
      {emptyAllowlistWarning}
    </p>
  ) : null;

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
            <p className="text-ink text-sm font-medium">Trigger runs automatically</p>
            <p className={SETTING_DESCRIPTION_CLASS}>
              An auto-triggered cycle runs entirely in the sandbox and parks at ready. It never
              approves a patch, never reaches the landing gate, and never leaves the free lane — so
              nothing gets to a real branch, a pushed commit or a resolved thread without the same
              explicit confirmation as a run you started yourself.
            </p>
          </div>
          <Toggle
            isChecked={isAutomationEnabled}
            onChange={onEnabledChange}
            label={enabledToggleLabel}
            isLabelHidden
            isDisabled={isUpdateSettingsPending}
          />
        </div>

        {emptyAllowlistNotice}

        <form onSubmit={onAddAuthorsSubmit} className="border-border/70 border-t pt-5">
          <label htmlFor={ALLOWLIST_INPUT_ID} className="text-ink text-sm font-medium">
            Author allowlist
          </label>
          <p className={SETTING_DESCRIPTION_CLASS}>
            Only comments from these GitHub logins trigger a run. An empty list triggers nothing:
            enabling automation without naming anyone does nothing at all rather than reacting to
            everyone. Separate several with commas or spaces; a leading @ is ignored.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={ALLOWLIST_INPUT_ID}
              type="text"
              value={allowlistDraft}
              placeholder={ALLOWLIST_PLACEHOLDER}
              spellCheck={false}
              autoComplete="off"
              disabled={isUpdateSettingsPending}
              onChange={onAllowlistDraftChange}
              className={TEXT_INPUT_CLASS}
            />
            <Button
              type={BUTTON_TYPE.SUBMIT}
              variant={BUTTON_VARIANT.SECONDARY}
              isDisabled={isAddAuthorsDisabled}
              isLoading={isUpdateSettingsPending}
            >
              {ADD_AUTHORS_LABEL}
            </Button>
          </div>
          {allowlistContent}
        </form>

        <div className={SETTING_ROW_CLASS}>
          <div className="min-w-0">
            <label htmlFor={MAX_AUTO_RUNS_SELECT_ID} className="text-ink text-sm font-medium">
              Auto-runs per hour
            </label>
            <p className={SETTING_DESCRIPTION_CLASS}>
              A runaway guard, not a throughput dial. This work starts while you are away, so the
              number is the most a burst of comments may set going in an hour before automation
              stops on its own — not a target to raise for speed. The concurrency cap still applies
              on top of it.
            </p>
          </div>
          <select
            id={MAX_AUTO_RUNS_SELECT_ID}
            value={maxAutoRunsPerHour}
            disabled={isUpdateSettingsPending}
            onChange={onMaxAutoRunsPerHourChange}
            className={SELECT_CLASS}
          >
            {maxAutoRunsOptionElements}
          </select>
        </div>

        <div className={SETTING_ROW_CLASS}>
          <div className="min-w-0">
            <label htmlFor={POLL_INTERVAL_SELECT_ID} className="text-ink text-sm font-medium">
              Poll interval
            </label>
            <p className={SETTING_DESCRIPTION_CLASS}>
              Webhooks need a public endpoint a desktop app does not have, so watched pull requests
              are polled. Each poll checks the PR's updatedAt before it queries any comments, which
              is what keeps a short interval affordable against your gh rate limit.
            </p>
          </div>
          <select
            id={POLL_INTERVAL_SELECT_ID}
            value={pollIntervalMs}
            disabled={isUpdateSettingsPending}
            onChange={onPollIntervalChange}
            className={SELECT_CLASS}
          >
            {pollIntervalOptionElements}
          </select>
        </div>
      </div>
    );
  })();

  return (
    <Card padding={CARD_PADDING.LG}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-ink text-sm font-semibold">Automation</h2>
          <p className="text-muted mt-1 text-xs leading-relaxed">
            Off by default. When it is on, a new comment from an author you have named starts a
            resolution cycle without being asked — and stops at the review gate, exactly where a run
            you started by hand would.
          </p>
        </div>
        <Badge tone={BADGE_TONE.NEUTRAL} isMuted>
          {automationSummaryLabel}
        </Badge>
      </header>
      {body}
    </Card>
  );
}
