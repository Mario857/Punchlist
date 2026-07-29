import type { ReactNode } from 'react';
import { joinClassNames } from '@renderer/lib/classNames';

interface Props {
  /** The accessible name and the hover explanation — a glyph alone says too little. */
  title: string;
  icon: ReactNode;
  className?: string;
}

const TOOLTIP_CLASS = joinClassNames(
  'pointer-events-none absolute top-full left-1/2 z-20 mt-1 hidden -translate-x-1/2',
  'w-max max-w-64 rounded-md border px-2 py-1 shadow-lg',
  'border-border bg-surface-raised text-ink text-xs leading-snug font-normal',
  'group-hover:block',
);

/**
 * A secondary fact as a bare mark. The tree's rows were carrying up to five text
 * badges and the comment itself was the thing being truncated for them; StateBadge is
 * the one signal that keeps words, and everything else is a glyph.
 *
 * The tooltip is our own rather than the native `title`: a mark whose meaning only
 * appears after a second of dead hover might as well have none, and these glyphs are
 * the only place the words live.
 */
export function RowGlyph({ title, icon, className }: Props) {
  return (
    <span
      role="img"
      aria-label={title}
      className={joinClassNames('group relative inline-flex shrink-0 items-center', className)}
    >
      {icon}
      <span className={TOOLTIP_CLASS}>{title}</span>
    </span>
  );
}
