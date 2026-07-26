import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { FileIcon } from '@renderer/components/icons/FileIcon';
import { assertNever } from '@renderer/lib/assertNever';
import { DiffHunk } from '@renderer/modules/review/CommentDetail/components/DiffHunk';
import {
  COMMENT_DETAIL_KIND_VIEW,
  type CommentDetailKindView,
} from '@renderer/modules/review/CommentDetail/useCommentDetail';

interface Props {
  view: CommentDetailKindView;
}

const ANCHOR_ICON_SIZE = 12;

export function CommentKindDetail({ view }: Props) {
  const content = (() => {
    switch (view.kind) {
      case COMMENT_DETAIL_KIND_VIEW.ANCHORED: {
        const resolvedBadge = view.isResolved ? (
          <Badge isMuted tone={BADGE_TONE.SUCCESS}>
            Resolved
          </Badge>
        ) : null;
        const outdatedBadge = view.isOutdated ? (
          <Badge isMuted tone={BADGE_TONE.WARNING}>
            Outdated
          </Badge>
        ) : null;

        return (
          <Card padding={CARD_PADDING.SM} tone={CARD_TONE.RAISED}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <FileIcon size={ANCHOR_ICON_SIZE} className="text-muted shrink-0" />
                <span className="text-ink min-w-0 truncate font-mono text-xs">{view.path}</span>
                <span className="text-muted text-xs tabular-nums">{view.lineLabel}</span>
                {resolvedBadge}
                {outdatedBadge}
              </div>
              <DiffHunk diffHunk={view.diffHunk} />
            </div>
          </Card>
        );
      }
      case COMMENT_DETAIL_KIND_VIEW.UNANCHORED:
        return (
          <Card padding={CARD_PADDING.SM} tone={CARD_TONE.RAISED}>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Badge isMuted tone={BADGE_TONE.INFO}>
                  Unanchored
                </Badge>
                <span className="text-muted text-xs">{view.kindLabel}</span>
              </div>
              <p className="text-muted/80 text-xs leading-snug">{view.explanation}</p>
            </div>
          </Card>
        );
      default:
        return assertNever(view);
    }
  })();

  return content;
}
