import { REPO_SOURCE, type LocalRepo } from '@shared/discovery';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { BUTTON_VARIANT } from '@renderer/components/Button';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { FolderIcon } from '@renderer/components/icons/FolderIcon';
import { XIcon } from '@renderer/components/icons/XIcon';
import { assertNever } from '@renderer/lib/assertNever';

export interface RepoRegistryRowProps {
  repo: LocalRepo;
  isRemoveDisabled: boolean;
  onRemoveClick: () => void;
}

export function RepoRegistryRow({ repo, isRemoveDisabled, onRemoveClick }: RepoRegistryRowProps) {
  const { sourceLabel, sourceTitle, sourceTone } = (() => {
    switch (repo.source) {
      case REPO_SOURCE.SCAN:
        return {
          sourceLabel: 'Scanned',
          sourceTitle: 'Found under the scan root. A rescan replaces every scanned entry.',
          sourceTone: BADGE_TONE.NEUTRAL,
        };
      case REPO_SOURCE.MANUAL:
        return {
          sourceLabel: 'Manual',
          sourceTitle: 'Added by hand. Survives a rescan.',
          sourceTone: BADGE_TONE.INFO,
        };
      default:
        return assertNever(repo.source);
    }
  })();

  const repoKeyBadges = repo.repoKeys.map((repoKey) => (
    <Badge key={repoKey} tone={BADGE_TONE.NEUTRAL} isMuted>
      {repoKey}
    </Badge>
  ));

  const repoKeysContent =
    repo.repoKeys.length === 0 ? (
      <p className="text-muted/70 mt-2 text-xs">
        No GitHub remote matched, so no pull request maps to this clone.
      </p>
    ) : (
      <div className="mt-2 flex flex-wrap gap-1.5">{repoKeyBadges}</div>
    );

  return (
    <li className="border-border/70 flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <FolderIcon className="text-muted shrink-0" />
          <span className="text-ink truncate text-sm font-medium">{repo.name}</span>
          <Badge tone={sourceTone} isMuted title={sourceTitle}>
            {sourceLabel}
          </Badge>
        </div>
        <p className="text-muted mt-1 truncate font-mono text-xs" title={repo.path}>
          {repo.path}
        </p>
        {repoKeysContent}
      </div>
      <IconButton
        label={`Remove ${repo.name} from the registry`}
        icon={<XIcon />}
        variant={BUTTON_VARIANT.GHOST}
        size={ICON_BUTTON_SIZE.SM}
        isDisabled={isRemoveDisabled}
        onClick={onRemoveClick}
      />
    </li>
  );
}
