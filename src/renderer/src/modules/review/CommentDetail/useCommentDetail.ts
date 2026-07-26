import { COMMENT_KIND, type CommentReply, type PrComment } from '@shared/comments';
import { assertNever } from '@renderer/lib/assertNever';
import { formatDateTime } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import type { CommentReplyItem } from '@renderer/modules/review/CommentDetail/components/CommentReplies';

export const COMMENT_DETAIL_KIND_VIEW = {
  ANCHORED: 'anchored',
  UNANCHORED: 'unanchored',
} as const;

/**
 * Collapses the three comment kinds onto the two shapes the pane actually renders:
 * an inline thread has a file, a line and a hunk, and everything else has none of
 * them. Which one it is stays a compiler guarantee rather than an optional field.
 */
export type CommentDetailKindView =
  | {
      kind: typeof COMMENT_DETAIL_KIND_VIEW.ANCHORED;
      path: string;
      lineLabel: string;
      diffHunk: string;
      isResolved: boolean;
      isOutdated: boolean;
    }
  | {
      kind: typeof COMMENT_DETAIL_KIND_VIEW.UNANCHORED;
      kindLabel: string;
      explanation: string;
    };

export interface CommentDetailView {
  authorLogin: string;
  isBotAuthor: boolean;
  createdAtLabel: string;
  bodyText: string;
  hasBody: boolean;
  url: string;
  replyItems: CommentReplyItem[];
  replyCountLabel: string;
  hasReplies: boolean;
  kindView: CommentDetailKindView;
}

interface UseCommentDetailResult {
  /** Null is the purposeful empty state, not an absent render. */
  detail: CommentDetailView | null;
  emptyStateLabel: string;
}

const EMPTY_STATE_LABEL = 'Select a comment to read it here.';
const EMPTY_BODY_TEXT = 'This comment has no body.';
const CREATED_LABEL_PREFIX = 'Created ';
const LINE_LABEL_PREFIX = 'line ';
const UNKNOWN_LINE_LABEL = 'line unknown';
const REVIEW_BODY_KIND_LABEL = 'Review summary';
const CONVERSATION_KIND_LABEL = 'PR conversation';
const SINGLE_REPLY_COUNT_LABEL = '1 reply';
const NO_REPLY_COUNT = 0;
const SINGLE_REPLY_COUNT = 1;
const EMPTY_BODY_LENGTH = 0;

/**
 * Unanchored comments are marked rather than silently rendered without an anchor:
 * a run on one has to locate the code itself, so a surprising diff is explainable.
 */
const UNANCHORED_EXPLANATION =
  'No file or line anchor exists for this comment, so a run has to locate the relevant code itself before changing anything.';

function toReplyItem(reply: CommentReply, index: number): CommentReplyItem {
  return { key: String(index), author: reply.author, body: reply.body };
}

function toReplyCountLabel(replyCount: number): string {
  if (replyCount === SINGLE_REPLY_COUNT) return SINGLE_REPLY_COUNT_LABEL;
  return `${replyCount} replies`;
}

function toKindView(comment: PrComment): CommentDetailKindView {
  switch (comment.kind) {
    case COMMENT_KIND.INLINE_THREAD:
      return {
        kind: COMMENT_DETAIL_KIND_VIEW.ANCHORED,
        path: comment.anchor.path,
        // A null line is what GitHub reports once the anchor has drifted off the diff.
        lineLabel: isDefined(comment.anchor.line)
          ? `${LINE_LABEL_PREFIX}${comment.anchor.line}`
          : UNKNOWN_LINE_LABEL,
        diffHunk: comment.anchor.diffHunk,
        isResolved: comment.isResolved,
        isOutdated: comment.isOutdated,
      };
    case COMMENT_KIND.REVIEW_BODY:
      return {
        kind: COMMENT_DETAIL_KIND_VIEW.UNANCHORED,
        kindLabel: REVIEW_BODY_KIND_LABEL,
        explanation: UNANCHORED_EXPLANATION,
      };
    case COMMENT_KIND.CONVERSATION:
      return {
        kind: COMMENT_DETAIL_KIND_VIEW.UNANCHORED,
        kindLabel: CONVERSATION_KIND_LABEL,
        explanation: UNANCHORED_EXPLANATION,
      };
    default:
      // The comment itself, not its `kind`: UnanchoredComment's discriminant carries
      // two literals, so exhausting all three narrows the comment to never while
      // `kind` is no longer a readable property.
      return assertNever(comment);
  }
}

export function useCommentDetail(comment: PrComment | null): UseCommentDetailResult {
  if (comment === null) return { detail: null, emptyStateLabel: EMPTY_STATE_LABEL };

  const hasBody = comment.body.trim().length > EMPTY_BODY_LENGTH;
  const replyCount = comment.replies.length;

  return {
    detail: {
      authorLogin: comment.author.login,
      isBotAuthor: comment.author.isBot,
      createdAtLabel: `${CREATED_LABEL_PREFIX}${formatDateTime(comment.createdAt)}`,
      bodyText: hasBody ? comment.body : EMPTY_BODY_TEXT,
      hasBody,
      url: comment.url,
      replyItems: comment.replies.map(toReplyItem),
      replyCountLabel: toReplyCountLabel(replyCount),
      hasReplies: replyCount > NO_REPLY_COUNT,
      kindView: toKindView(comment),
    },
    emptyStateLabel: EMPTY_STATE_LABEL,
  };
}
