import { Badge } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';

export interface PrPickerRowItem {
  /** `prRefKey` of the PR — the React key and the identity used for selection. */
  prKey: string;
  repoKey: string;
  numberLabel: string;
  title: string;
  authorLabel: string;
  updatedLabel: string;
  /** The raw `updatedAt` timestamp, so the relative label never loses precision. */
  updatedTitle: string;
  isDraft: boolean;
  isSelected: boolean;
  /**
   * Null when the PR has no local clone. Resolution runs in a git worktree, so such a
   * row is listed but cannot be selected as if it would work — `notClonedNotice`
   * carries the reason and the two are set together.
   */
  onSelect: (() => void) | null;
  notClonedNotice: string | null;
  /** Null when the repo is already cloned, so there is nothing to offer. */
  cloneLabel: string | null;
  isClonePending: boolean;
  onCloneClick: (() => void) | null;
}

interface Props {
  item: PrPickerRowItem;
}

const NOTICE_ICON_SIZE = 12;
const NOTICE_CLASS = 'flex flex-col items-start gap-2';

const ROW_SURFACE_CLASS = 'flex w-full flex-col gap-1 rounded-md border p-2.5 text-left';

export function PrPickerRow({ item }: Props) {
  const draftBadge = item.isDraft ? (
    <Badge isMuted title="Draft pull request">
      Draft
    </Badge>
  ) : null;

  // The notice says why the row cannot be selected; the action is what fixes it, so
  // the two belong together rather than sending someone to Settings to hunt for it.
  const cloneAction =
    item.cloneLabel === null || item.onCloneClick === null ? null : (
      <Button
        variant={BUTTON_VARIANT.SECONDARY}
        size={BUTTON_SIZE.SM}
        isLoading={item.isClonePending}
        onClick={item.onCloneClick}
      >
        {item.cloneLabel}
      </Button>
    );

  const notice =
    item.notClonedNotice === null ? null : (
      <div className={NOTICE_CLASS}>
        <p className="text-warning/90 flex items-start gap-1.5 text-xs leading-snug">
          <AlertTriangleIcon size={NOTICE_ICON_SIZE} className="mt-0.5 shrink-0" />
          {item.notClonedNotice}
        </p>
        {cloneAction}
      </div>
    );

  const content = (
    <>
      <div className="flex items-center gap-2">
        <span className="text-muted min-w-0 truncate text-xs">{item.repoKey}</span>
        <span className="text-muted text-xs tabular-nums">{item.numberLabel}</span>
        {draftBadge}
      </div>
      <p className="text-ink truncate text-sm font-medium">{item.title}</p>
      <div className="text-muted/80 flex min-w-0 items-center gap-2 text-xs">
        <span className="min-w-0 truncate">{item.authorLabel}</span>
        <span title={item.updatedTitle} className="tabular-nums">
          {item.updatedLabel}
        </span>
      </div>
    </>
  );

  const surface =
    item.onSelect === null ? (
      <div className={joinClassNames(ROW_SURFACE_CLASS, 'border-border/60 bg-surface/50 gap-1.5')}>
        {content}
        {notice}
      </div>
    ) : (
      <button
        type="button"
        aria-current={item.isSelected}
        onClick={item.onSelect}
        className={joinClassNames(
          ROW_SURFACE_CLASS,
          item.isSelected
            ? 'border-accent/60 bg-surface-hover'
            : 'border-border bg-surface hover:border-border-strong hover:bg-surface-raised',
          FOCUS_RING,
          INTERACTIVE_TRANSITION,
        )}
      >
        {content}
      </button>
    );

  return <li>{surface}</li>;
}
