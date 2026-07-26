import { Badge } from '@renderer/components/Badge';
import { BotIcon } from '@renderer/components/icons/BotIcon';
import { ExternalLinkIcon } from '@renderer/components/icons/ExternalLinkIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { CommentKindDetail } from '@renderer/modules/review/CommentDetail/components/CommentKindDetail';
import { CommentReplies } from '@renderer/modules/review/CommentDetail/components/CommentReplies';
import type { CommentDetailView } from '@renderer/modules/review/CommentDetail/useCommentDetail';

interface Props {
  detail: CommentDetailView;
}

const BOT_ICON_SIZE = 11;
const EXTERNAL_LINK_ICON_SIZE = 12;

export function CommentDetailBody({ detail }: Props) {
  const botBadge = detail.isBotAuthor ? (
    <Badge isMuted icon={<BotIcon size={BOT_ICON_SIZE} />} title="Authored by a bot">
      Bot
    </Badge>
  ) : null;

  const repliesBlock = detail.hasReplies ? (
    <CommentReplies items={detail.replyItems} countLabel={detail.replyCountLabel} />
  ) : null;

  const bodyClassName = joinClassNames(
    'text-sm leading-relaxed break-words whitespace-pre-wrap',
    detail.hasBody ? 'text-ink' : 'text-muted/70 italic',
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-ink text-sm font-semibold">{detail.authorLogin}</span>
          {botBadge}
          {/* A plain anchor: main routes every new-window request to the system browser. */}
          <a
            href={detail.url}
            target="_blank"
            rel="noreferrer"
            className={joinClassNames(
              'text-muted hover:text-ink ml-auto inline-flex items-center gap-1 rounded text-xs',
              FOCUS_RING,
              INTERACTIVE_TRANSITION,
            )}
          >
            View on GitHub
            <ExternalLinkIcon size={EXTERNAL_LINK_ICON_SIZE} />
          </a>
        </div>
        <p className="text-muted/80 text-xs tabular-nums">{detail.createdAtLabel}</p>
      </header>

      <CommentKindDetail view={detail.kindView} />

      <p className={bodyClassName}>{detail.bodyText}</p>

      {repliesBlock}
    </div>
  );
}
