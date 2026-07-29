import { Badge } from '@renderer/components/Badge';
import { CollapsibleCard } from '@renderer/components/CollapsibleCard/CollapsibleCard';
import { BotIcon } from '@renderer/components/icons/BotIcon';
import { ExternalLinkIcon } from '@renderer/components/icons/ExternalLinkIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { CommentTierBadge } from '@renderer/modules/comments/CommentTree/components/CommentTierBadge/CommentTierBadge';
import { CommentKindDetail } from '@renderer/modules/review/CommentDetail/components/CommentKindDetail';
import { CommentReplies } from '@renderer/modules/review/CommentDetail/components/CommentReplies';
import type { CommentDetailView } from '@renderer/modules/review/CommentDetail/useCommentDetail';

interface Props {
  detail: CommentDetailView;
}

const BOT_ICON_SIZE = 11;
const EXTERNAL_LINK_ICON_SIZE = 12;
const REPLIES_SECTION_ID = 'comment-replies';
const REPLIES_HEADING = 'Replies';
const META_SEPARATOR = '·';

/**
 * The comment reads as the heading of the work rather than as a pane of its own: one
 * identity line, then what was actually asked. Everything that is reference material —
 * the code the comment was left on, the thread that followed — folds away, because the
 * patch below is answering the question and the question is what has to stay in view.
 */
export function CommentDetailBody({ detail }: Props) {
  // The tier lives with the comment it prices, not on every tree row: one glance
  // here answers it, and the tree keeps its width for the comment text.
  const tierBadge = detail.isTierShown ? <CommentTierBadge comment={detail.comment} /> : null;

  const botBadge = detail.isBotAuthor ? (
    <Badge isMuted icon={<BotIcon size={BOT_ICON_SIZE} />} title="Authored by a bot">
      Bot
    </Badge>
  ) : null;

  const repliesBlock = !detail.hasReplies ? null : (
    <CollapsibleCard
      sectionId={REPLIES_SECTION_ID}
      heading={REPLIES_HEADING}
      summary={detail.replyCountLabel}
      isDefaultOpen={false}
    >
      <CommentReplies items={detail.replyItems} countLabel={detail.replyCountLabel} />
    </CollapsibleCard>
  );

  const bodyClassName = joinClassNames(
    'text-sm leading-relaxed break-words whitespace-pre-wrap',
    detail.hasBody ? 'text-ink' : 'text-muted/70 italic',
  );

  return (
    <div className="flex shrink-0 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-ink shrink-0 text-sm font-semibold">{detail.authorLogin}</span>
        {botBadge}
        <span className="text-muted/60 text-xs">{META_SEPARATOR}</span>
        <span className="text-muted/80 truncate text-xs tabular-nums">{detail.createdAtLabel}</span>
        {tierBadge}
        {/* A plain anchor: main routes every new-window request to the system browser. */}
        <a
          href={detail.url}
          target="_blank"
          rel="noreferrer"
          className={joinClassNames(
            'text-muted hover:text-ink ml-auto inline-flex shrink-0 items-center gap-1 rounded text-xs',
            FOCUS_RING,
            INTERACTIVE_TRANSITION,
          )}
        >
          View on GitHub
          <ExternalLinkIcon size={EXTERNAL_LINK_ICON_SIZE} />
        </a>
      </div>

      <p className={bodyClassName}>{detail.bodyText}</p>

      <CommentKindDetail view={detail.kindView} />

      {repliesBlock}
    </div>
  );
}
