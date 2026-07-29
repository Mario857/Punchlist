import type { ReactNode } from 'react';
import { joinClassNames } from '@renderer/lib/classNames';

interface Props {
  /** The accessible name and the hover explanation — a glyph alone says too little. */
  title: string;
  icon: ReactNode;
  className?: string;
}

/**
 * A secondary fact as a bare mark. The tree's rows were carrying up to five text
 * badges and the comment itself was the thing being truncated for them; StateBadge is
 * the one signal that keeps words, and everything else is a glyph with a tooltip.
 */
export function RowGlyph({ title, icon, className }: Props) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={joinClassNames('inline-flex shrink-0 items-center', className)}
    >
      {icon}
    </span>
  );
}
