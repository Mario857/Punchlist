import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { LandingCommentLink } from '@renderer/modules/landing/LandingPreview/components/LandingCommentLink';
import type { LandingConflictsView } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

interface Props {
  view: LandingConflictsView;
}

const CONFLICT_ICON_SIZE = 14;

const COLUMN_CLASS = 'flex flex-col gap-3';
const HEADING_CLASS = 'text-danger text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const LIST_CLASS = 'flex flex-col gap-2';
const ITEM_CLASS = 'border-border bg-surface flex flex-col gap-1.5 rounded-md border p-2';
const ITEM_HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const ITEM_TITLE_CLASS = 'text-ink min-w-0 flex-1 text-xs font-semibold';
const CONFLICT_ICON_CLASS = 'text-danger shrink-0';
const PATHS_CLASS = 'text-ink font-mono text-xs break-words';
const ACTION_ROW_CLASS = 'flex items-center gap-2';

/**
 * A blocking finding, not a warning: the merges really happened in the sandbox. Re-running
 * the comment's agent is what resolves one, so the only action offered here is assembling
 * again once that has happened.
 */
export function LandingConflictList({ view }: Props) {
  const items = view.items.map((item) => (
    <li key={item.runId} className={ITEM_CLASS}>
      <div className={ITEM_HEADER_CLASS}>
        <AlertTriangleIcon size={CONFLICT_ICON_SIZE} className={CONFLICT_ICON_CLASS} />
        <h4 className={ITEM_TITLE_CLASS}>{item.commentLabel}</h4>
        <LandingCommentLink url={item.commentUrl} label={item.commentLinkLabel} />
      </div>
      <p className={PATHS_CLASS}>{item.pathsLabel}</p>
    </li>
  ));

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <div>
        <h3 className={HEADING_CLASS}>{view.heading}</h3>
        <p className={EXPLANATION_CLASS}>{view.explanation}</p>
      </div>
      <ul aria-label={view.heading} className={LIST_CLASS}>
        {items}
      </ul>
      <div className={ACTION_ROW_CLASS}>
        <Button
          variant={BUTTON_VARIANT.SECONDARY}
          size={BUTTON_SIZE.SM}
          isLoading={view.isReassembling}
          title={view.reassembleLabel}
          onClick={view.onReassembleClick}
        >
          {view.reassembleLabel}
        </Button>
      </div>
    </Card>
  );
}
