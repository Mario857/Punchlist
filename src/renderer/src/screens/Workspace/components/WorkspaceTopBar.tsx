import type { PrRef } from '@shared/discovery';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { ChevronDownIcon } from '@renderer/components/icons/ChevronDownIcon';
import { ChevronLeftIcon } from '@renderer/components/icons/ChevronLeftIcon';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { DISABLED_STATE, FOCUS_RING } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { PaneToggles } from '@renderer/screens/Workspace/components/PaneToggles';
import type { PaneToggleItem } from '@renderer/screens/Workspace/useWorkspace';

interface Props {
  selectedPr: PrRef | null;
  isPickerOpen: boolean;
  isRefreshing: boolean;
  onTogglePicker: () => void;
  onRefreshComments: () => void;
  onShowShortcutHelp: () => void;
  targetBranch: string;
  paneToggleItems: PaneToggleItem[];
  isLandingOpen: boolean;
  onTargetBranchChange: (targetBranch: string) => void;
  onToggleLanding: () => void;
}

const NO_PR_LABEL = 'No pull request selected';
const CHOOSE_PR_LABEL = 'Choose a pull request';
const BACK_TO_COMMENTS_LABEL = 'Back to comments';
const SWITCH_PR_TITLE = 'Switch to another pull request';
const CHEVRON_ICON_SIZE = 12;
/** The visible equivalent of `?`, so the keyboard map is discoverable by mouse. */
const SHORTCUT_HELP_LABEL = '?';
const SHORTCUT_HELP_TITLE = 'Keyboard shortcuts';
const TARGET_BRANCH_INPUT_ID = 'workspace-target-branch';
const TARGET_BRANCH_LABEL = 'Target branch';
/** Says where a landing would go, not that anything has gone there. */
const TARGET_BRANCH_TITLE =
  'Where an approved batch would land. Defaults to the branch this pull request is open against; the integration branch is pushed as its own branch, and this one is never pushed to directly.';
const OPEN_LANDING_LABEL = 'Review landing';
const CLOSE_LANDING_LABEL = 'Back to comments';
const TARGET_BRANCH_INPUT_CLASS =
  'border-border bg-surface-raised text-ink w-40 rounded border px-2 py-1 text-sm';

export function WorkspaceTopBar({
  selectedPr,
  isPickerOpen,
  isRefreshing,
  onTogglePicker,
  onRefreshComments,
  onShowShortcutHelp,
  targetBranch,
  paneToggleItems,
  isLandingOpen,
  onTargetBranchChange,
  onToggleLanding,
}: Props) {
  const prLabel = (() => {
    if (selectedPr === null) return isPickerOpen ? NO_PR_LABEL : CHOOSE_PR_LABEL;
    return `${selectedPr.repoKey} #${selectedPr.number}`;
  })();

  // Nothing to toggle back to before a PR is chosen, and nothing to refresh either.
  const isPickerToggleDisabled = selectedPr === null && isPickerOpen;

  // The PR identity is itself the switcher: clicking what you are working on is how
  // you change it, the way an editor's window title works — no standing back button
  // for a screen there is no reason to leave. The picker keeps a way back out.
  const leadingControl = (() => {
    if (isPickerOpen && selectedPr !== null) {
      return (
        <Button
          variant={BUTTON_VARIANT.GHOST}
          size={BUTTON_SIZE.SM}
          icon={<ChevronLeftIcon size={CHEVRON_ICON_SIZE} />}
          onClick={onTogglePicker}
        >
          {BACK_TO_COMMENTS_LABEL}
        </Button>
      );
    }
    return (
      <Button
        variant={BUTTON_VARIANT.GHOST}
        size={BUTTON_SIZE.SM}
        icon={<ChevronDownIcon size={CHEVRON_ICON_SIZE} />}
        isDisabled={isPickerToggleDisabled}
        title={SWITCH_PR_TITLE}
        onClick={onTogglePicker}
      >
        {prLabel}
      </Button>
    );
  })();

  const isRefreshDisabled = selectedPr === null;
  const isTargetBranchDisabled = selectedPr === null;
  // Nothing to rearrange until there are panes to rearrange.
  const isLayoutToggleDisabled = selectedPr === null;
  const landingLabel = isLandingOpen ? CLOSE_LANDING_LABEL : OPEN_LANDING_LABEL;
  // Nothing to hide or show while the picker owns the whole area.
  const paneToggles = isLayoutToggleDisabled ? null : <PaneToggles items={paneToggleItems} />;

  return (
    <header
      className={joinClassNames(
        'flex items-center justify-between gap-3',
        'border-border border-b px-4 py-2',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">{leadingControl}</div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="text-muted text-xs" htmlFor={TARGET_BRANCH_INPUT_ID}>
          {TARGET_BRANCH_LABEL}
        </label>
        <input
          id={TARGET_BRANCH_INPUT_ID}
          type="text"
          value={targetBranch}
          title={TARGET_BRANCH_TITLE}
          disabled={isTargetBranchDisabled}
          onChange={(event) => onTargetBranchChange(event.target.value)}
          className={joinClassNames(TARGET_BRANCH_INPUT_CLASS, FOCUS_RING, DISABLED_STATE)}
        />
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isTargetBranchDisabled}
          onClick={onToggleLanding}
        >
          {landingLabel}
        </Button>
        <IconButton
          label="Refresh comments"
          icon={<RefreshIcon />}
          variant={BUTTON_VARIANT.GHOST}
          size={ICON_BUTTON_SIZE.SM}
          isLoading={isRefreshing}
          isDisabled={isRefreshDisabled}
          onClick={onRefreshComments}
        />
        {paneToggles}
        <Button
          variant={BUTTON_VARIANT.GHOST}
          size={BUTTON_SIZE.SM}
          title={SHORTCUT_HELP_TITLE}
          onClick={onShowShortcutHelp}
        >
          {SHORTCUT_HELP_LABEL}
        </Button>
      </div>
    </header>
  );
}
