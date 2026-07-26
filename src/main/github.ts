import { z } from 'zod';
import {
  COMMENT_KIND,
  type CommentAuthor,
  type CommentReply,
  type InlineThreadComment,
  type PrComment,
  type UnanchoredComment,
} from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import { runGhJson } from './ghCli';

const GRAPHQL_PAGE_SIZE = 100;
const REPO_KEY_SEPARATOR = '/';
const REPO_KEY_SEGMENT_COUNT = 2;

/** What github.com itself shows in place of a deleted account's comments. */
const GHOST_AUTHOR_LOGIN = 'ghost';
const BOT_AUTHOR_TYPENAME = 'Bot';
const BOT_LOGIN_SUFFIX = '[bot]';

/**
 * Three collections, three calls: `--paginate` follows a single `$endCursor`, so a
 * query containing more than one paginated connection cannot be auto-paginated.
 */
const REVIEW_THREADS_QUERY = `
query PrReviewThreads($owner: String!, $repo: String!, $number: Int!, $pageSize: Int!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: $pageSize, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: $pageSize) {
            nodes {
              id
              body
              createdAt
              url
              diffHunk
              author { login __typename }
            }
          }
        }
      }
    }
  }
}
`;

const REVIEWS_QUERY = `
query PrReviews($owner: String!, $repo: String!, $number: Int!, $pageSize: Int!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviews(first: $pageSize, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          body
          createdAt
          url
          author { login __typename }
        }
      }
    }
  }
}
`;

const CONVERSATION_COMMENTS_QUERY = `
query PrConversationComments($owner: String!, $repo: String!, $number: Int!, $pageSize: Int!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      comments(first: $pageSize, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          body
          createdAt
          url
          author { login __typename }
        }
      }
    }
  }
}
`;

/**
 * A deleted GitHub account leaves its comments in place with a null author, so this
 * is nullable at the schema level rather than assumed present.
 */
const graphqlAuthorSchema = z
  .object({
    login: z.string(),
    __typename: z.string(),
  })
  .nullable();

const graphqlUnanchoredNodeSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
  author: graphqlAuthorSchema,
});

const graphqlThreadCommentSchema = graphqlUnanchoredNodeSchema.extend({
  diffHunk: z.string(),
});

const graphqlReviewThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  line: z.number().nullable(),
  comments: z.object({ nodes: z.array(graphqlThreadCommentSchema) }),
});

const reviewThreadPagesSchema = z.array(
  z.object({
    data: z.object({
      repository: z.object({
        pullRequest: z.object({
          reviewThreads: z.object({ nodes: z.array(graphqlReviewThreadSchema) }),
        }),
      }),
    }),
  }),
);

const reviewPagesSchema = z.array(
  z.object({
    data: z.object({
      repository: z.object({
        pullRequest: z.object({
          reviews: z.object({ nodes: z.array(graphqlUnanchoredNodeSchema) }),
        }),
      }),
    }),
  }),
);

const conversationCommentPagesSchema = z.array(
  z.object({
    data: z.object({
      repository: z.object({
        pullRequest: z.object({
          comments: z.object({ nodes: z.array(graphqlUnanchoredNodeSchema) }),
        }),
      }),
    }),
  }),
);

type GraphqlAuthor = z.infer<typeof graphqlAuthorSchema>;
type GraphqlUnanchoredNode = z.infer<typeof graphqlUnanchoredNodeSchema>;
type GraphqlThreadComment = z.infer<typeof graphqlThreadCommentSchema>;
type GraphqlReviewThread = z.infer<typeof graphqlReviewThreadSchema>;

interface RepoCoordinates {
  owner: string;
  repo: string;
}

function splitRepoKey(repoKey: string): RepoCoordinates {
  const segments = repoKey.split(REPO_KEY_SEPARATOR).filter((segment) => segment.length > 0);
  if (segments.length !== REPO_KEY_SEGMENT_COUNT) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `"${repoKey}" is not an owner/repo repository key.`,
      null,
    );
  }

  const [owner, repo] = segments;
  return { owner, repo };
}

function buildGraphqlArgs(document: string, ref: PrRef): string[] {
  const { owner, repo } = splitRepoKey(ref.repoKey);
  return [
    'api',
    'graphql',
    '--paginate',
    // gh emits one JSON object per page, concatenated — which is not valid JSON as a
    // whole. --slurp wraps the pages into an array so the stream can be parsed at all.
    '--slurp',
    '-f',
    `query=${document}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `repo=${repo}`,
    // -F sends a typed value; -f would send these as String and fail the Int! variables.
    '-F',
    `number=${ref.number}`,
    '-F',
    `pageSize=${GRAPHQL_PAGE_SIZE}`,
  ];
}

function normalizeAuthor(author: GraphqlAuthor): CommentAuthor {
  if (author === null) return { login: GHOST_AUTHOR_LOGIN, isBot: false };

  return {
    login: author.login,
    // Some bots post through ordinary user accounts, where the typename is User and
    // only the login suffix gives them away.
    isBot: author.__typename === BOT_AUTHOR_TYPENAME || author.login.endsWith(BOT_LOGIN_SUFFIX),
  };
}

function normalizeReply(comment: GraphqlThreadComment): CommentReply {
  return { author: normalizeAuthor(comment.author).login, body: comment.body };
}

/**
 * The first comment in a review thread is the thread root — the review remark itself.
 * Everything after it is a reply to that remark, so the thread collapses to one
 * PrComment carrying its own replies rather than N sibling comments.
 */
function normalizeReviewThread(thread: GraphqlReviewThread): InlineThreadComment[] {
  const [root, ...replies] = thread.comments.nodes;
  if (root === undefined) return [];

  return [
    {
      kind: COMMENT_KIND.INLINE_THREAD,
      id: root.id,
      threadId: thread.id,
      body: root.body,
      author: normalizeAuthor(root.author),
      createdAt: root.createdAt,
      url: root.url,
      replies: replies.map(normalizeReply),
      anchor: { path: thread.path, line: thread.line, diffHunk: root.diffHunk },
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
    },
  ];
}

/** Most reviews carry no summary body at all — an empty one is not a comment. */
function normalizeReview(review: GraphqlUnanchoredNode): UnanchoredComment[] {
  if (review.body.trim().length === 0) return [];

  return [
    {
      kind: COMMENT_KIND.REVIEW_BODY,
      id: review.id,
      body: review.body,
      author: normalizeAuthor(review.author),
      createdAt: review.createdAt,
      url: review.url,
      replies: [],
    },
  ];
}

function normalizeConversationComment(comment: GraphqlUnanchoredNode): UnanchoredComment {
  return {
    kind: COMMENT_KIND.CONVERSATION,
    id: comment.id,
    body: comment.body,
    author: normalizeAuthor(comment.author),
    createdAt: comment.createdAt,
    url: comment.url,
    replies: [],
  };
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareByCreatedAt(left: PrComment, right: PrComment): number {
  const byCreatedAt = compareStrings(left.createdAt, right.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  // A review and the inline comments submitted with it share a timestamp, so the id
  // breaks the tie and keeps the tree order identical across refetches.
  return compareStrings(left.id, right.id);
}

async function fetchReviewThreads(ref: PrRef): Promise<InlineThreadComment[]> {
  const pages = await runGhJson(
    buildGraphqlArgs(REVIEW_THREADS_QUERY, ref),
    reviewThreadPagesSchema,
  );

  return pages.flatMap((page) =>
    page.data.repository.pullRequest.reviewThreads.nodes.flatMap(normalizeReviewThread),
  );
}

async function fetchReviewBodies(ref: PrRef): Promise<UnanchoredComment[]> {
  const pages = await runGhJson(buildGraphqlArgs(REVIEWS_QUERY, ref), reviewPagesSchema);

  return pages.flatMap((page) =>
    page.data.repository.pullRequest.reviews.nodes.flatMap(normalizeReview),
  );
}

async function fetchConversationComments(ref: PrRef): Promise<UnanchoredComment[]> {
  const pages = await runGhJson(
    buildGraphqlArgs(CONVERSATION_COMMENTS_QUERY, ref),
    conversationCommentPagesSchema,
  );

  return pages.flatMap((page) =>
    page.data.repository.pullRequest.comments.nodes.map(normalizeConversationComment),
  );
}

export async function fetchPrComments(ref: PrRef): Promise<PrComment[]> {
  const [inlineThreads, reviewBodies, conversationComments] = await Promise.all([
    fetchReviewThreads(ref),
    fetchReviewBodies(ref),
    fetchConversationComments(ref),
  ]);

  return [...inlineThreads, ...reviewBodies, ...conversationComments].sort(compareByCreatedAt);
}
