import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_TYPE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { FolderIcon } from '@renderer/components/icons/FolderIcon';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { isDefined } from '@renderer/lib/guards';
import { joinClassNames } from '@renderer/lib/classNames';
import { RepoRegistryRow } from '@renderer/modules/settings/RepoRegistry/components/RepoRegistryRow';
import { useRepoRegistry } from '@renderer/modules/settings/RepoRegistry/useRepoRegistry';

const SCAN_ROOT_INPUT_ID = 'settings-repo-scan-root';
const SCAN_ROOT_PLACEHOLDER = '/Users/you/Projects';

const TEXT_INPUT_CLASS = joinClassNames(
  'h-9 min-w-0 flex-1 rounded-md border px-3',
  'font-mono text-sm',
  'border-border bg-surface-raised text-ink placeholder:text-muted/60',
  'hover:border-border-strong',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

export function RepoRegistry() {
  const {
    repoRows,
    hasRepos,
    repoCountLabel,
    isReposLoading,
    reposErrorMessage,
    settingsErrorMessage,
    scanRootValue,
    isScanRootSaveDisabled,
    isUpdateSettingsPending,
    isRepoRegistryPending,
    onScanRootChange,
    onScanRootSubmit,
    onRescanClick,
    onAddRepoClick,
  } = useRepoRegistry();

  const settingsErrorLine = isDefined(settingsErrorMessage) ? (
    <p role="alert" className="text-danger mt-2 text-xs">
      {settingsErrorMessage}
    </p>
  ) : null;

  const rows = repoRows.map((row) => (
    <RepoRegistryRow
      key={row.repo.path}
      repo={row.repo}
      isRemoveDisabled={isRepoRegistryPending}
      onRemoveClick={row.onRemoveClick}
    />
  ));

  const body = (() => {
    if (isReposLoading) {
      return (
        <p className="text-muted mt-4 flex items-center gap-2 text-sm">
          <Spinner size={SPINNER_SIZE.SM} label="Loading the repo registry" />
          Loading registered clones…
        </p>
      );
    }

    if (isDefined(reposErrorMessage)) {
      return (
        <p role="alert" className="text-danger mt-4 text-sm">
          {reposErrorMessage}
        </p>
      );
    }

    if (!hasRepos) {
      return (
        <div className="border-border/70 mt-4 rounded-md border border-dashed p-4 text-center">
          <p className="text-ink text-sm font-medium">No local clones registered</p>
          <p className="text-muted mx-auto mt-1 max-w-md text-xs leading-relaxed">
            Discovery lists every open pull request you can see, but resolving one needs a clone on
            disk because each run gets its own git worktree. Set a scan root above and rescan, or
            add a single clone with Add folder.
          </p>
        </div>
      );
    }

    return <ul className="mt-4 flex flex-col gap-2">{rows}</ul>;
  })();

  return (
    <Card padding={CARD_PADDING.LG}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-ink text-sm font-semibold">Local repositories</h2>
          <p className="text-muted mt-1 text-xs leading-relaxed">
            Discovery is global; resolution needs a clone on disk. A pull request becomes actionable
            once one of these clones has a remote matching its base repo — every remote is checked,
            not just origin, so fork workflows resolve.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={BADGE_TONE.NEUTRAL} isMuted>
            {repoCountLabel}
          </Badge>
          <Button
            size={BUTTON_SIZE.SM}
            variant={BUTTON_VARIANT.SECONDARY}
            icon={<RefreshIcon />}
            isDisabled={isRepoRegistryPending}
            onClick={onRescanClick}
          >
            Rescan
          </Button>
          <Button
            size={BUTTON_SIZE.SM}
            variant={BUTTON_VARIANT.PRIMARY}
            icon={<FolderIcon />}
            isDisabled={isRepoRegistryPending}
            onClick={onAddRepoClick}
          >
            Add folder
          </Button>
        </div>
      </header>

      <form onSubmit={onScanRootSubmit} className="border-border/70 mt-4 border-t pt-4">
        <label htmlFor={SCAN_ROOT_INPUT_ID} className="text-ink text-sm font-medium">
          Scan root
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id={SCAN_ROOT_INPUT_ID}
            type="text"
            value={scanRootValue}
            placeholder={SCAN_ROOT_PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            disabled={isUpdateSettingsPending}
            onChange={onScanRootChange}
            className={TEXT_INPUT_CLASS}
          />
          <Button
            type={BUTTON_TYPE.SUBMIT}
            variant={BUTTON_VARIANT.SECONDARY}
            isDisabled={isScanRootSaveDisabled}
            isLoading={isUpdateSettingsPending}
          >
            Save
          </Button>
        </div>
        <p className="text-muted mt-2 text-xs leading-relaxed">
          Every directory under this root that contains a .git is registered on rescan. Leave it
          empty to register clones only by hand — a manual entry survives a rescan either way.
        </p>
        {settingsErrorLine}
      </form>

      {body}
    </Card>
  );
}
