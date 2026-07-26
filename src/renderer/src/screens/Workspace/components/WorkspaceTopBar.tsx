import type { PrRef } from '@shared/discovery';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { joinClassNames } from '@renderer/lib/classNames';

interface Props {
  selectedPr: PrRef | null;
  isPickerOpen: boolean;
  isRefreshing: boolean;
  onTogglePicker: () => void;
  onRefreshComments: () => void;
  onShowShortcutHelp: () => void;
}

const NO_PR_LABEL = 'No pull request selected';
/** The visible equivalent of `?`, so the keyboard map is discoverable by mouse. */
const SHORTCUT_HELP_LABEL = '?';
const SHORTCUT_HELP_TITLE = 'Keyboard shortcuts';

export function WorkspaceTopBar({
  selectedPr,
  isPickerOpen,
  isRefreshing,
  onTogglePicker,
  onRefreshComments,
  onShowShortcutHelp,
}: Props) {
  const prLabel = selectedPr === null ? NO_PR_LABEL : `${selectedPr.repoKey} #${selectedPr.number}`;

  const pickerLabel = (() => {
    if (selectedPr === null) return 'Choose a pull request';
    if (isPickerOpen) return 'Back to comments';
    return 'Change';
  })();

  // Nothing to toggle back to before a PR is chosen, and nothing to refresh either.
  const isPickerToggleDisabled = selectedPr === null && isPickerOpen;
  const isRefreshDisabled = selectedPr === null;

  return (
    <header
      className={joinClassNames(
        'flex items-center justify-between gap-3',
        'border-border border-b px-4 py-2',
      )}
    >
      <p className="text-ink truncate text-sm font-medium tabular-nums">{prLabel}</p>
      <div className="flex shrink-0 items-center gap-2">
        <IconButton
          label="Refresh comments"
          icon={<RefreshIcon />}
          variant={BUTTON_VARIANT.GHOST}
          size={ICON_BUTTON_SIZE.SM}
          isLoading={isRefreshing}
          isDisabled={isRefreshDisabled}
          onClick={onRefreshComments}
        />
        <Button
          variant={BUTTON_VARIANT.GHOST}
          size={BUTTON_SIZE.SM}
          title={SHORTCUT_HELP_TITLE}
          onClick={onShowShortcutHelp}
        >
          {SHORTCUT_HELP_LABEL}
        </Button>
        <Button
          variant={BUTTON_VARIANT.SECONDARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isPickerToggleDisabled}
          onClick={onTogglePicker}
        >
          {pickerLabel}
        </Button>
      </div>
    </header>
  );
}
