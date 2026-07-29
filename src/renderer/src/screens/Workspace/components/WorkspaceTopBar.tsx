import type { PrRef } from '@shared/discovery';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { ChevronLeftIcon } from '@renderer/components/icons/ChevronLeftIcon';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { joinClassNames } from '@renderer/lib/classNames';
import { PaneToggles } from '@renderer/screens/Workspace/components/PaneToggles';
import type { PaneToggleItem } from '@renderer/screens/Workspace/useWorkspace';

interface Props {
  selectedPr: PrRef | null;
  isRefreshing: boolean;
  /** False only on the home screen, where there is nowhere further up to go. */
  isBackAvailable: boolean;
  onBackClick: () => void;
  onRefreshComments: () => void;
  onShowShortcutHelp: () => void;
  paneToggleItems: PaneToggleItem[];
}

const BACK_LABEL = 'Back';
/** The visible equivalent of `?`, so the keyboard map is discoverable by mouse. */
const SHORTCUT_HELP_LABEL = '?';
const SHORTCUT_HELP_TITLE = 'Keyboard shortcuts';

/**
 * Identity and navigation only: one chevron that always goes a level up — landing to
 * comments, comments to the pull request list — the PR named in plain text, and the
 * pane utilities. The work actions live in the run controls row, where the work is.
 */
export function WorkspaceTopBar({
  selectedPr,
  isRefreshing,
  isBackAvailable,
  onBackClick,
  onRefreshComments,
  onShowShortcutHelp,
  paneToggleItems,
}: Props) {
  const leadingControls = !isBackAvailable ? null : (
    <>
      <IconButton
        label={BACK_LABEL}
        icon={<ChevronLeftIcon />}
        variant={BUTTON_VARIANT.GHOST}
        size={ICON_BUTTON_SIZE.SM}
        onClick={onBackClick}
      />
      <p className="text-ink truncate text-sm font-medium tabular-nums">
        {selectedPr === null ? null : `${selectedPr.repoKey} #${selectedPr.number}`}
      </p>
    </>
  );

  const isRefreshDisabled = selectedPr === null;
  // Nothing to rearrange or refresh while the list owns the whole area.
  const paneToggles = selectedPr === null ? null : <PaneToggles items={paneToggleItems} />;

  return (
    <header
      className={joinClassNames(
        'flex items-center justify-between gap-3',
        'border-border border-b px-4 py-2',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">{leadingControls}</div>
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
