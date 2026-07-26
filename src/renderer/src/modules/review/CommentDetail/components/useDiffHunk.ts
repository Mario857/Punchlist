export const DIFF_LINE_KIND = {
  HUNK_HEADER: 'hunkHeader',
  ADDITION: 'addition',
  DELETION: 'deletion',
  CONTEXT: 'context',
} as const;

export type DiffLineKind = (typeof DIFF_LINE_KIND)[keyof typeof DIFF_LINE_KIND];

export interface DiffHunkLine {
  key: string;
  kind: DiffLineKind;
  text: string;
}

interface UseDiffHunkResult {
  lines: DiffHunkLine[];
}

const LINE_SEPARATOR = '\n';
/** `@@` is tested first: a hunk header also starts with neither `+` nor `-`. */
const HUNK_HEADER_PREFIX = '@@';
const ADDITION_PREFIX = '+';
const DELETION_PREFIX = '-';

function toLineKind(text: string): DiffLineKind {
  if (text.startsWith(HUNK_HEADER_PREFIX)) return DIFF_LINE_KIND.HUNK_HEADER;
  if (text.startsWith(ADDITION_PREFIX)) return DIFF_LINE_KIND.ADDITION;
  if (text.startsWith(DELETION_PREFIX)) return DIFF_LINE_KIND.DELETION;
  return DIFF_LINE_KIND.CONTEXT;
}

export function useDiffHunk(diffHunk: string): UseDiffHunkResult {
  const lines = diffHunk.split(LINE_SEPARATOR).map((text, index) => ({
    key: String(index),
    kind: toLineKind(text),
    text,
  }));

  return { lines };
}
