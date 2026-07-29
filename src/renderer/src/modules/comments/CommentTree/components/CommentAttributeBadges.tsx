import { COMMENT_KIND, type PrComment } from '@shared/comments';
import { assertNever } from '@renderer/lib/assertNever';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { BotIcon } from '@renderer/components/icons/BotIcon';
import { CheckIcon } from '@renderer/components/icons/CheckIcon';
import { RowGlyph } from './RowGlyph';

export interface CommentAttributeBadgesProps {
  comment: PrComment;
}

/** Matches the run glyphs, so every small mark on a row agrees in weight. */
const ATTRIBUTE_GLYPH_SIZE = 12;

const BOT_TITLE = 'Authored by a bot';
const RESOLVED_TITLE = 'Already resolved on GitHub';
const OUTDATED_TITLE = 'Outdated: anchored to a line the PR has since changed';

/**
 * Secondary attributes only, and only when they are true — as bare glyphs, because
 * StateBadge is the row's single worded signal and the comment text is what the row
 * exists to show. Unanchored comments carry no mark at all: the group they sit under
 * already says what they are.
 */
export function CommentAttributeBadges({ comment }: CommentAttributeBadgesProps) {
  const botGlyph = comment.author.isBot ? (
    <RowGlyph
      title={BOT_TITLE}
      icon={<BotIcon size={ATTRIBUTE_GLYPH_SIZE} />}
      className="text-muted"
    />
  ) : null;

  const kindGlyphs = (() => {
    switch (comment.kind) {
      case COMMENT_KIND.INLINE_THREAD: {
        const resolvedGlyph = comment.isResolved ? (
          <RowGlyph
            title={RESOLVED_TITLE}
            icon={<CheckIcon size={ATTRIBUTE_GLYPH_SIZE} />}
            className="text-success/70"
          />
        ) : null;
        const outdatedGlyph = comment.isOutdated ? (
          <RowGlyph
            title={OUTDATED_TITLE}
            icon={<AlertTriangleIcon size={ATTRIBUTE_GLYPH_SIZE} />}
            className="text-muted"
          />
        ) : null;
        return (
          <>
            {resolvedGlyph}
            {outdatedGlyph}
          </>
        );
      }
      case COMMENT_KIND.REVIEW_BODY:
      case COMMENT_KIND.CONVERSATION:
        return null;
      default:
        return assertNever(comment);
    }
  })();

  return (
    <>
      {botGlyph}
      {kindGlyphs}
    </>
  );
}
