import { z } from 'zod';
import { appendAuditEntry } from '@main/audit';
import {
  assertSandboxConfirmation,
  SANDBOX_EXIT_ACTION,
  type SandboxConfirmation,
} from '@main/sandbox';
import { AUDIT_ACTION } from '@shared/audit';
import type { PrStatus } from '@shared/automation';
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
 * The watcher's first stage. `headRefOid` is a scalar on the pull request itself, so
 * the whole check is one unpaginated object rather than a walk over commits — which is
 * the point: the three queries above only run when `updatedAt` here has moved.
 */
const PR_STATUS_QUERY = `
query PrStatus($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      updatedAt
      headRefOid
    }
  }
}
`;

/**
 * The three mutations below are the only calls in the app that change anything on
 * GitHub, and all three are GraphQL-only: `gh pr` has no equivalent of resolving,
 * unresolving or replying to a review thread, which is why the CLI is driven through
 * `gh api graphql` rather than a convenience subcommand.
 *
 * Each takes the `PRRT_`-prefixed **thread node id** — the id of the thread, not of
 * the comment that opened it. `InlineThreadComment` carries both, and passing the
 * comment id here fails at the API with a type mismatch rather than silently
 * resolving the wrong thing.
 */
const RESOLVE_REVIEW_THREAD_MUTATION = `
mutation ResolveReviewThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}
`;

const UNRESOLVE_REVIEW_THREAD_MUTATION = `
mutation UnresolveReviewThread($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}
`;

/**
 * The reply's own `body` is deliberately not in the selection set. There is no reason
 * to have GitHub echo user prose back into a response this process parses, formats
 * into error messages and hands to the audit path — the id and url are what a reader
 * needs to find the comment.
 */
const ADD_REVIEW_THREAD_REPLY_MUTATION = `
mutation AddReviewThreadReply($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id url }
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

const prStatusResultSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        updatedAt: z.string(),
        headRefOid: z.string(),
      }),
    }),
  }),
});

/**
 * `isResolved` is pinned to the state the mutation is supposed to have produced, so a
 * response that parses but reports the thread still open is a failure rather than a
 * success — the audit entry is written from this, and an entry claiming a resolve that
 * did not happen is what the undo path would later try to replay.
 */
const resolveReviewThreadResultSchema = z.object({
  data: z.object({
    resolveReviewThread: z.object({
      thread: z.object({ id: z.string(), isResolved: z.literal(true) }),
    }),
  }),
});

const unresolveReviewThreadResultSchema = z.object({
  data: z.object({
    unresolveReviewThread: z.object({
      thread: z.object({ id: z.string(), isResolved: z.literal(false) }),
    }),
  }),
});

const addReviewThreadReplyResultSchema = z.object({
  data: z.object({
    addPullRequestReviewThreadReply: z.object({
      comment: z.object({ id: z.string(), url: z.string() }),
    }),
  }),
});

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

/**
 * No `--paginate` and no `--slurp` here, unlike the queries above: a mutation must run
 * exactly once, and `--paginate` would re-issue it for every page it believes exists.
 * Without `--slurp` the output is a single JSON object rather than an array of pages.
 */
function buildGraphqlMutationArgs(document: string, variables: Record<string, string>): string[] {
  const args = ['api', 'graphql', '-f', `query=${document}`];
  for (const [name, value] of Object.entries(variables)) {
    // -f rather than -F: raw-field sends the value verbatim, while -F coerces it and
    // reads an @-prefixed value from a file — which a reply body is allowed to start with.
    args.push('-f', `${name}=${value}`);
  }
  return args;
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

/**
 * The cheap first stage of the watcher's poll: one small query the watcher can afford
 * every sixty seconds, whose result decides whether `fetchPrComments` runs at all.
 *
 * Built like the mutations rather than like the queries above — no `--paginate` and no
 * `--slurp`, because a single object has no pages to follow and the output is one JSON
 * object rather than an array of them.
 */
export async function fetchPrStatus(ref: PrRef): Promise<PrStatus> {
  const { owner, repo } = splitRepoKey(ref.repoKey);
  const result = await runGhJson(
    [
      'api',
      'graphql',
      '-f',
      `query=${PR_STATUS_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `repo=${repo}`,
      // -F sends a typed value; -f would send this as String and fail the Int! variable.
      '-F',
      `number=${ref.number}`,
    ],
    prStatusResultSchema,
  );

  const { updatedAt, headRefOid } = result.data.repository.pullRequest;
  return { updatedAt, headSha: headRefOid };
}

/**
 * Marks a review thread resolved on GitHub. The `SandboxConfirmation` is a required
 * parameter because this leaves the sandbox: the type makes the call unwritable without
 * one, and the assertion below makes it unrunnable with one minted for a different
 * action — belt and braces, because a confirmation never crosses IPC and the compiler
 * cannot see the provenance of a value that arrived through a channel.
 */
export async function resolveReviewThread(
  threadId: string,
  confirmation: SandboxConfirmation,
  landingId: string,
): Promise<void> {
  assertSandboxConfirmation(confirmation, SANDBOX_EXIT_ACTION.RESOLVE_REVIEW_THREAD);

  await runGhJson(
    buildGraphqlMutationArgs(RESOLVE_REVIEW_THREAD_MUTATION, { threadId }),
    resolveReviewThreadResultSchema,
  );

  // Audited only after GitHub has confirmed it, never before: an undo replays the
  // landing from these entries, so an entry for something that did not happen would
  // send it to unresolve a thread nobody resolved.
  await appendAuditEntry({
    action: AUDIT_ACTION.THREAD_RESOLVED,
    summary: `Resolved review thread ${threadId}`,
    threadIds: [threadId],
    landingId,
  });
}

/** The reverse of `resolveReviewThread`, on the same thread node id an undo replays from. */
export async function unresolveReviewThread(
  threadId: string,
  confirmation: SandboxConfirmation,
  landingId: string,
): Promise<void> {
  assertSandboxConfirmation(confirmation, SANDBOX_EXIT_ACTION.UNRESOLVE_REVIEW_THREAD);

  await runGhJson(
    buildGraphqlMutationArgs(UNRESOLVE_REVIEW_THREAD_MUTATION, { threadId }),
    unresolveReviewThreadResultSchema,
  );

  await appendAuditEntry({
    action: AUDIT_ACTION.THREAD_UNRESOLVED,
    summary: `Reopened review thread ${threadId}`,
    threadIds: [threadId],
    landingId,
  });
}

/**
 * Posts `body` as a reply under an existing review thread, from the user's own account.
 *
 * The body never reaches the audit log: the entry records that a reply was posted and to
 * which thread, because the log holds actions rather than the content they were taken
 * on. It stays out of error strings too — `ghCli` summarises a failed command by its
 * first two arguments (`gh api`), so the field carrying it is never echoed back.
 */
export async function postReviewThreadReply(
  threadId: string,
  body: string,
  confirmation: SandboxConfirmation,
  landingId: string,
): Promise<void> {
  assertSandboxConfirmation(confirmation, SANDBOX_EXIT_ACTION.POST_REPLY);

  await runGhJson(
    buildGraphqlMutationArgs(ADD_REVIEW_THREAD_REPLY_MUTATION, { threadId, body }),
    addReviewThreadReplyResultSchema,
  );

  await appendAuditEntry({
    action: AUDIT_ACTION.REPLY_POSTED,
    summary: `Posted a reply to review thread ${threadId}`,
    threadIds: [threadId],
    landingId,
  });
}
