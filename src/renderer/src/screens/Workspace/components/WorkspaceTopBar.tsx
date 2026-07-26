import type { PrRef } from '@shared/discovery';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
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
const BACK_TO_LIST_LABEL = 'Pull requests';
const BACK_TO_COMMENTS_LABEL = 'Comments';
const BACK_ICON_SIZE = 12;
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
  const prLabel = selectedPr === null ? NO_PR_LABEL : `${selectedPr.repoKey} #${selectedPr.number}`;

  // One leading control that always goes back a level: to the pull request list from
  // the workspace, and to the workspace from the list.
  const backLabel = (() => {
    if (selectedPr === null) return CHOOSE_PR_LABEL;
    if (isPickerOpen) return BACK_TO_COMMENTS_LABEL;
    return BACK_TO_LIST_LABEL;
  })();

  // Nothing to toggle back to before a PR is chosen, and nothing to refresh either.
  const isPickerToggleDisabled = selectedPr === null && isPickerOpen;
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
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant={BUTTON_VARIANT.GHOST}
          size={BUTTON_SIZE.SM}
          icon={<ChevronLeftIcon size={BACK_ICON_SIZE} />}
          isDisabled={isPickerToggleDisabled}
          onClick={onTogglePicker}
        >
          {backLabel}
        </Button>
        <p className="text-ink truncate text-sm font-medium tabular-nums">{prLabel}</p>
      </div>
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
