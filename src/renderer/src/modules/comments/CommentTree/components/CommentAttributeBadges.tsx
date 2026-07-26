import { COMMENT_KIND, type PrComment } from '@shared/comments';
import { assertNever } from '@renderer/lib/assertNever';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { BotIcon } from '@renderer/components/icons/BotIcon';

export interface CommentAttributeBadgesProps {
  comment: PrComment;
}

/** Matches TreeRow's checkbox glyph, so every small mark on a row agrees in weight. */
const ATTRIBUTE_BADGE_ICON_SIZE = 11;

const BOT_LABEL = 'Bot';
const BOT_TITLE = 'Authored by a bot';
const RESOLVED_LABEL = 'Resolved';
const RESOLVED_TITLE = 'Already resolved on GitHub';
const OUTDATED_LABEL = 'Outdated';
const OUTDATED_TITLE = 'Anchored to a line the PR has since changed';
const UNANCHORED_LABEL = 'Unanchored';
const UNANCHORED_TITLE = 'No file or line to anchor a fix to';

/**
 * Secondary attributes only, and only when they are true. They render muted because
 * StateBadge is the row's single strong signal — a row of eight equal badges reads the
 * same as a row of none.
 */
export function CommentAttributeBadges({ comment }: CommentAttributeBadgesProps) {
  const botBadge = comment.author.isBot ? (
    <Badge
      tone={BADGE_TONE.NEUTRAL}
      isMuted
      title={BOT_TITLE}
      icon={<BotIcon size={ATTRIBUTE_BADGE_ICON_SIZE} />}
    >
      {BOT_LABEL}
    </Badge>
  ) : null;

  const kindBadges = (() => {
    switch (comment.kind) {
      case COMMENT_KIND.INLINE_THREAD: {
        const resolvedBadge = comment.isResolved ? (
          <Badge tone={BADGE_TONE.SUCCESS} isMuted title={RESOLVED_TITLE}>
            {RESOLVED_LABEL}
          </Badge>
        ) : null;
        const outdatedBadge = comment.isOutdated ? (
          <Badge
            tone={BADGE_TONE.WARNING}
            isMuted
            title={OUTDATED_TITLE}
            icon={<AlertTriangleIcon size={ATTRIBUTE_BADGE_ICON_SIZE} />}
          >
            {OUTDATED_LABEL}
          </Badge>
        ) : null;
        return (
          <>
            {resolvedBadge}
            {outdatedBadge}
          </>
        );
      }
      case COMMENT_KIND.REVIEW_BODY:
      case COMMENT_KIND.CONVERSATION:
        return (
          <Badge tone={BADGE_TONE.NEUTRAL} isMuted title={UNANCHORED_TITLE}>
            {UNANCHORED_LABEL}
          </Badge>
        );
      default:
        return assertNever(comment);
    }
  })();

  return (
    <>
      {botBadge}
      {kindBadges}
    </>
  );
}
