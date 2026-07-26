import { FOCUS_RING } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import {
  DIFF_LINE_KIND,
  useDiffHunk,
  type DiffLineKind,
} from '@renderer/modules/review/CommentDetail/components/useDiffHunk';

interface Props {
  diffHunk: string;
}

const DIFF_LINE_CLASS: Record<DiffLineKind, string> = {
  [DIFF_LINE_KIND.HUNK_HEADER]: 'text-info/90 bg-info/10',
  [DIFF_LINE_KIND.ADDITION]: 'text-success bg-success/10',
  [DIFF_LINE_KIND.DELETION]: 'text-danger bg-danger/10',
  [DIFF_LINE_KIND.CONTEXT]: 'text-muted',
};

/** A hunk is arbitrarily long, so it scrolls inside the pane instead of growing it. */
const DIFF_HUNK_MAX_HEIGHT_CLASS = 'max-h-64';

/** A scrollable region has to be reachable by keyboard, not only by wheel or trackpad. */
const DIFF_HUNK_TAB_INDEX = 0;

const DIFF_HUNK_LABEL = 'Diff hunk';

export function DiffHunk({ diffHunk }: Props) {
  const { lines } = useDiffHunk(diffHunk);

  const lineElements = lines.map((line) => (
    <span
      key={line.key}
      className={joinClassNames('block min-h-4 px-2', DIFF_LINE_CLASS[line.kind])}
    >
      {line.text}
    </span>
  ));

  return (
    <pre
      tabIndex={DIFF_HUNK_TAB_INDEX}
      aria-label={DIFF_HUNK_LABEL}
      className={joinClassNames(
        'border-border bg-bg-0/60 overflow-auto rounded-md border py-1.5',
        'font-mono text-xs leading-relaxed',
        DIFF_HUNK_MAX_HEIGHT_CLASS,
        FOCUS_RING,
      )}
    >
      {lineElements}
    </pre>
  );
}
