import { z } from 'zod';

export const COMMENT_KIND = {
  INLINE_THREAD: 'inlineThread',
  REVIEW_BODY: 'reviewBody',
  CONVERSATION: 'conversation',
} as const;

export type CommentKind = (typeof COMMENT_KIND)[keyof typeof COMMENT_KIND];

const commentAuthorSchema = z.object({
  login: z.string(),
  isBot: z.boolean(),
});

const commentReplySchema = z.object({
  author: z.string(),
  body: z.string(),
});

const prCommentBaseSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: commentAuthorSchema,
  createdAt: z.string(),
  url: z.string(),
  replies: z.array(commentReplySchema),
});

const commentAnchorSchema = z.object({
  path: z.string(),
  line: z.number().nullable(),
  diffHunk: z.string(),
});

/**
 * Only inline threads carry an anchor and resolution state, and only they can be
 * resolved through the API — so that is a discriminated union rather than one
 * flat shape with optional fields the compiler cannot police.
 */
export const inlineThreadCommentSchema = prCommentBaseSchema.extend({
  kind: z.literal(COMMENT_KIND.INLINE_THREAD),
  // The PRRT_-prefixed thread node id, which is what resolveReviewThread and
  // unresolveReviewThread consume. Not the comment id.
  threadId: z.string(),
  anchor: commentAnchorSchema,
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
});

export const unanchoredCommentSchema = prCommentBaseSchema.extend({
  kind: z.union([z.literal(COMMENT_KIND.REVIEW_BODY), z.literal(COMMENT_KIND.CONVERSATION)]),
});

export const prCommentSchema = z.discriminatedUnion('kind', [
  inlineThreadCommentSchema,
  unanchoredCommentSchema,
]);

export type CommentAuthor = z.infer<typeof commentAuthorSchema>;
export type CommentReply = z.infer<typeof commentReplySchema>;
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export type InlineThreadComment = z.infer<typeof inlineThreadCommentSchema>;
export type UnanchoredComment = z.infer<typeof unanchoredCommentSchema>;
export type PrComment = z.infer<typeof prCommentSchema>;

export function isInlineThread(comment: PrComment): comment is InlineThreadComment {
  return comment.kind === COMMENT_KIND.INLINE_THREAD;
}

/**
 * Zod-backed rather than a plain interface because the filter bar's state is
 * persisted with the session, and a store written by an older version of the app
 * is one of this project's untrusted parse boundaries. Every field defaults, so
 * an older record widens to the current shape instead of failing to parse.
 */
export const commentFiltersSchema = z.object({
  isUnresolvedOnly: z.boolean().default(false),
  shouldHideBots: z.boolean().default(false),
  shouldHideOutdated: z.boolean().default(false),
  authors: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
});

export type CommentFilters = z.infer<typeof commentFiltersSchema>;

export const DEFAULT_COMMENT_FILTERS: CommentFilters = commentFiltersSchema.parse({});

/**
 * Filters are a view concern over the fully fetched set: filtering at fetch time
 * would mean a refetch per toggle and would make "3 of 21 resolved" impossible.
 */
export function matchesCommentFilters(comment: PrComment, filters: CommentFilters): boolean {
  if (filters.shouldHideBots && comment.author.isBot) return false;
  if (filters.authors.length > 0 && !filters.authors.includes(comment.author.login)) return false;

  if (isInlineThread(comment)) {
    if (filters.isUnresolvedOnly && comment.isResolved) return false;
    if (filters.shouldHideOutdated && comment.isOutdated) return false;
    if (filters.paths.length > 0 && !filters.paths.includes(comment.anchor.path)) return false;
    return true;
  }

  // An unanchored comment has no path, so a path filter excludes it by construction.
  return filters.paths.length === 0;
}

/** The recommended set auto mode pre-selects: actionable and not already stale. */
export function isRecommendedForRun(comment: PrComment): boolean {
  return isInlineThread(comment) && !comment.isResolved && !comment.isOutdated;
}
