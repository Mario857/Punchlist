import {
  COMMENT_KIND,
  isInlineThread,
  type CommentKind,
  type CommentReply,
  type InlineThreadComment,
  type PrComment,
} from '@shared/comments';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import { SELECTION_SIDE, type SelectionSide, type TargetedEditSelection } from '@shared/runs';

/**
 * The agent's scratch directory, excluded once via the repo's .git/info/exclude so it
 * never appears in a candidate diff. Named here because decision.ts reads the same two
 * files in phase 3 — one authoritative source for the paths, not two string literals.
 */
export const AIRLOCK_SCRATCH_DIR = '.airlock';
export const DECISION_FILE_PATH = `${AIRLOCK_SCRATCH_DIR}/decision.json`;
export const SUMMARY_FILE_PATH = `${AIRLOCK_SCRATCH_DIR}/summary.json`;

/** git's own convention: a longer subject wraps badly in `git log --oneline`. */
export const COMMIT_SUBJECT_MAX_LENGTH = 72;

const PROMPT_SECTION_SEPARATOR = '\n\n';
const REPLY_SEPARATOR = '\n';
const REPLY_BULLET = '- ';
const BODY_FENCE = '"""';
const DIFF_FENCE_OPEN = '```diff';
const JSON_FENCE_OPEN = '```json';
const FENCE_CLOSE = '```';
const AUTHOR_PREFIX = '@';
const UNKNOWN_LINE_LABEL = 'unknown (the hunk below is the anchor)';

/**
 * A `Record` keyed by the union gives the same exhaustiveness guarantee as a switch
 * with `assertNever`: adding a comment kind fails to compile until it is labelled.
 */
const COMMENT_KIND_LABEL: Record<CommentKind, string> = {
  [COMMENT_KIND.INLINE_THREAD]: 'inline review comment, anchored to a file and line',
  [COMMENT_KIND.REVIEW_BODY]: 'review summary comment, not anchored to any file',
  [COMMENT_KIND.CONVERSATION]: 'pull request conversation comment, not anchored to any file',
};

const ROLE_SECTION = `You are resolving a single review comment on a GitHub pull request.

You are working inside an isolated git worktree checked out at the pull request's head commit. Nothing you do here reaches the real repository: a human reads your diff and decides whether it lands.

Resolve exactly this one comment. Do not fix unrelated problems you notice along the way, do not reformat code you did not otherwise have to touch, and do not rename anything the comment did not ask you to rename. A diff larger than the comment justifies is a failed run, because a human has to review every line of it.

If the comment needs no code change at all — praise, a question already answered, a suggestion that no longer applies to this code — change nothing and say so in your final message. An empty diff is a valid and expected outcome, and far better than an invented change.`;

const ANCHORED_STRATEGY_SECTION = `This comment is anchored: the file, the line, and the diff hunk it was left on are given below, so you already have near-exact context. Start at that anchor and treat it as authoritative about what the reviewer was looking at.

If the fix genuinely requires touching other files, do it — but name those files and say why in your final message.`;

const UNANCHORED_STRATEGY_SECTION = `This comment is not anchored to any file or line. It is prose and nothing else, so locating the code it refers to is the first half of the job:

1. Decide what the comment is actually asking for.
2. Search the repository for the code it refers to. Read enough of the surrounding code to be sure.
3. In your final message, state which files and symbols you concluded the comment was about — before you describe what you changed. The reviewer cannot verify your patch without knowing what you aimed it at.

If the comment is too vague to locate confidently, do not guess at a target. Use the halt-and-ask protocol below: a patch against the wrong code is worse than a question.`;

const HALT_AND_ASK_SECTION = `Halt-and-ask protocol.

When you hit a genuine fork you cannot settle from the code — two defensible designs, an unmade decision about behaviour, real ambiguity about which of several call sites was meant — do not guess. Write \`${DECISION_FILE_PATH}\` (create the \`${AIRLOCK_SCRATCH_DIR}\` directory if it does not exist) and stop working:

${JSON_FENCE_OPEN}
{
  "question": "the one thing you need decided",
  "options": ["the option you would pick", "the next best option"],
  "context": "what you have already worked out"
}
${FENCE_CLOSE}

- \`question\`: phrased so that a one-line answer unblocks you.
- \`options\`: the candidate answers, **ordered best-first**. The first entry must be the one you would pick. That ordering is what makes taking the top option meaningful rather than arbitrary.
- \`context\`: what you already established, so that answering does not require re-reading the code from scratch.

Then stop. Leave any partial edits in the working tree, do not write the summary file, and do not continue on an assumption. A human answers, and the answer comes back to you in this same conversation with everything you have already worked out still in scope.

This is for real ambiguity only. Anything you can settle by reading the code, settle by reading the code.`;

const SUMMARY_SECTION = `When you have finished the work, write \`${SUMMARY_FILE_PATH}\`:

${JSON_FENCE_OPEN}
{
  "subject": "imperative summary of the change",
  "details": "what changed and why"
}
${FENCE_CLOSE}

This is the draft commit message for your change. You know what you changed; a template does not.

- \`subject\`: imperative mood ("Add", not "Added" or "Adds"), no trailing period, under ${COMMIT_SUBJECT_MAX_LENGTH} characters.
- \`details\`: what changed and why, in prose. Call out anything a reviewer should look at twice. Use \`null\` if the subject genuinely says everything.

If you concluded that no code change was warranted, do not write this file — explain in your final message instead.

The \`${AIRLOCK_SCRATCH_DIR}\` directory is scratch space for these two files only. Never put source changes there.`;

/**
 * Defense in depth, not the primary control: the real containment is the invalid
 * `remote.origin.pushurl` and the de-authenticated `gh` in the agent's environment,
 * because a prompt instruction is a request rather than a guarantee.
 */
const FORBIDDEN_COMMANDS_SECTION = `Commands you must not run.

- No git command that changes state: no \`commit\`, \`add\`, \`checkout\`, \`switch\`, \`branch\`, \`merge\`, \`rebase\`, \`reset\`, \`stash\`, \`push\`. Leave your work as uncommitted changes in the working tree — it gets committed for you after review. Read-only git is useful and fine: \`git log\`, \`git show\`, \`git diff\`, \`git blame\`.
- No network access: no \`gh\`, \`curl\`, \`wget\`, no package installs, no fetching anything. This repository plus the comment is all the context there is.`;

/**
 * `guardrails.ts` re-checks the candidate patch against the equivalent list in phase 4,
 * because a prompt instruction is a request. Keep the two lists consistent.
 */
const PROTECTED_PATHS_SECTION = `Paths you must not modify:

- lock files: \`bun.lock\`, \`package-lock.json\`, \`yarn.lock\`, \`pnpm-lock.yaml\`
- generated output: \`*.generated.*\`, \`out/\`, \`dist/\`, \`build/\`, \`node_modules/\`
- CI configuration: \`.github/workflows/\`
- environment and secret files: \`.env\`, \`.env.*\`, private keys
- vendored or third-party trees: \`vendor/\`, \`third_party/\`
- agent instruction files: \`.cursor/rules/\`, \`AGENTS.md\`, \`CLAUDE.md\`

If resolving the comment genuinely requires changing one of these, stop and use the halt-and-ask protocol rather than editing it.`;

const COMMON_PROTOCOL_SECTIONS = [
  HALT_AND_ASK_SECTION,
  SUMMARY_SECTION,
  FORBIDDEN_COMMANDS_SECTION,
  PROTECTED_PATHS_SECTION,
] as const;

function formatReplies(replies: readonly CommentReply[]): string {
  if (replies.length === 0) return '';

  const lines = replies.map(
    (reply) => `${REPLY_BULLET}${AUTHOR_PREFIX}${reply.author}: ${reply.body}`,
  );
  return `Replies on the thread, oldest first:
${lines.join(REPLY_SEPARATOR)}`;
}

// The comment's github.com URL is deliberately left out of every prompt: the agent has
// no network, so handing it a link only invites a fetch attempt that must fail.
function formatCommentBody(comment: PrComment): string {
  return `Comment by ${AUTHOR_PREFIX}${comment.author.login} (${COMMENT_KIND_LABEL[comment.kind]}):
${BODY_FENCE}
${comment.body}
${BODY_FENCE}`;
}

function formatAnchoredContext(comment: InlineThreadComment): string {
  const { path, line, diffHunk } = comment.anchor;
  return `File: ${path}
Line: ${line ?? UNKNOWN_LINE_LABEL}

The diff hunk the comment was left on:
${DIFF_FENCE_OPEN}
${diffHunk}
${FENCE_CLOSE}`;
}

const TARGETED_EDIT_ROLE_SECTION = `This is a scoped correction to the patch you have already produced in this worktree, not a new task. Everything you worked out earlier still holds: do not start over, do not re-derive the resolution, and do not revisit parts of the patch this message says nothing about.`;

/**
 * The two sides are different instructions, not the same instruction with different
 * context: one is "the code you wrote is wrong", the other is "there is code you never
 * touched that you should have". Collapsing them would lose the half of the meaning the
 * editor already knows for free.
 */
const MODIFIED_SELECTION_SECTION = `The region below is part of the patch you wrote, and it is what needs to change. Read this as "change this code you wrote": the reviewer is looking at your output, and this part of it is wrong, incomplete, or not how they want it expressed.`;

const ORIGINAL_SELECTION_SECTION = `The region below is code as it stands before your patch — code you read and left alone. Read this as "you missed this": the reviewer believes it should have been part of your change and it was not. Work out what it needs, then change it.`;

const SELECTION_ANCHOR_SECTION = `Locate that region by its text, not by its line numbers. The range is a hint from the editor and may already be stale, because anything you edited above it has moved it. The verbatim text is the anchor: if it no longer appears exactly as given, find where it went instead of editing whatever now sits at those line numbers.`;

const SELECTION_SCOPE_SECTION = `Confine your changes to that region. The rest of the patch has already been read and accepted, so every line you change outside the selection is a line someone has to review a second time. If the correction genuinely cannot be made without touching code elsewhere, make the smallest change that works and name every place you touched in your final message.

This is checked afterwards rather than taken on trust: a scoped edit that rewrites unrelated files is flagged before the diff reaches review.`;

const TARGETED_EDIT_PROTOCOL_SECTION = `Everything from the first message still applies: the halt-and-ask protocol, the commands you must not run, and the paths you must not modify. Rewrite \`${SUMMARY_FILE_PATH}\` so it describes the patch as it stands after this correction rather than as it was before it.`;

function formatSelectionSide(side: SelectionSide): string {
  switch (side) {
    case SELECTION_SIDE.MODIFIED:
      return MODIFIED_SELECTION_SECTION;
    case SELECTION_SIDE.ORIGINAL:
      return ORIGINAL_SELECTION_SECTION;
    default: {
      // Same reason as runState.ts: there is no main-side assertNever, the renderer's
      // living behind the process boundary, so exhaustiveness is asserted with a never
      // binding instead — adding a side to SELECTION_SIDE breaks this assignment.
      const unhandled: never = side;
      throw new AppError(APP_ERROR_KIND.UNKNOWN, `Unhandled selection side: ${String(unhandled)}`);
    }
  }
}

function formatSelectionContext(selection: TargetedEditSelection): string {
  return `File: ${selection.path}
Selected lines ${selection.startLine}–${selection.endLine}, which is a hint only:
${BODY_FENCE}
${selection.content}
${BODY_FENCE}`;
}

function formatSelectionInstruction(instruction: string): string {
  return `What is wrong with it, in the reviewer's words:
${BODY_FENCE}
${instruction}
${BODY_FENCE}`;
}

/**
 * The selection-scoped revision. Sent to the *same* agent through `agent.send`, so this
 * carries only what is new — the region and the correction — rather than rebuilding the
 * context the conversation already holds.
 */
export function buildTargetedEditPrompt(
  selection: TargetedEditSelection,
  instruction: string,
): string {
  const sections = [
    TARGETED_EDIT_ROLE_SECTION,
    formatSelectionSide(selection.side),
    formatSelectionContext(selection),
    SELECTION_ANCHOR_SECTION,
    formatSelectionInstruction(instruction),
    SELECTION_SCOPE_SECTION,
    TARGETED_EDIT_PROTOCOL_SECTION,
  ];

  return sections.join(PROMPT_SECTION_SEPARATOR);
}

/**
 * A pure builder: the anchor's presence, not the run's configuration, is what changes
 * the prompt, so there is nothing here to read from disk or from the SDK.
 */
export function buildResolutionPrompt(comment: PrComment): string {
  // The anchored branch carries a second section because the anchor is context the
  // unanchored branch has to go and find for itself.
  const strategySections = isInlineThread(comment)
    ? [ANCHORED_STRATEGY_SECTION, formatAnchoredContext(comment)]
    : [UNANCHORED_STRATEGY_SECTION];

  const sections = [
    ROLE_SECTION,
    ...strategySections,
    formatCommentBody(comment),
    formatReplies(comment.replies),
    ...COMMON_PROTOCOL_SECTIONS,
  ];

  return sections.filter((section) => section.length > 0).join(PROMPT_SECTION_SEPARATOR);
}
