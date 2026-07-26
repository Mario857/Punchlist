import type { ReactNode } from 'react';
import { mergeClassNames } from '@renderer/lib/classNames';

export const BADGE_TONE = {
  NEUTRAL: 'neutral',
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  DANGER: 'danger',
  ACCENT: 'accent',
} as const;

export type BadgeTone = (typeof BADGE_TONE)[keyof typeof BADGE_TONE];

export const BADGE_SIZE = {
  SM: 'sm',
  MD: 'md',
} as const;

export type BadgeSize = (typeof BADGE_SIZE)[keyof typeof BADGE_SIZE];

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  /**
   * Secondary row attributes — bot, outdated, unanchored, tier — render weak on
   * purpose. A row of equally loud badges communicates nothing, so only StateBadge
   * is strong and everything else opts into muted.
   */
  isMuted?: boolean;
  icon?: ReactNode;
  title?: string;
  className?: string;
}

/** Shared chrome, exported so StateBadge is the same pill without re-declaring it. */
export const BADGE_BASE_CLASS =
  'inline-flex shrink-0 items-center rounded-full border align-middle font-medium whitespace-nowrap';

export const BADGE_SIZE_CLASS: Record<BadgeSize, string> = {
  [BADGE_SIZE.SM]: 'h-5 gap-1 px-1.5 text-xs',
  [BADGE_SIZE.MD]: 'h-6 gap-1.5 px-2 text-sm',
};

const BADGE_STRONG_CLASS: Record<BadgeTone, string> = {
  [BADGE_TONE.NEUTRAL]: 'border-neutral/40 bg-neutral/20 text-neutral',
  [BADGE_TONE.INFO]: 'border-info/40 bg-info/20 text-info',
  [BADGE_TONE.SUCCESS]: 'border-success/40 bg-success/20 text-success',
  [BADGE_TONE.WARNING]: 'border-warning/40 bg-warning/20 text-warning',
  [BADGE_TONE.DANGER]: 'border-danger/40 bg-danger/20 text-danger',
  [BADGE_TONE.ACCENT]: 'border-accent/40 bg-accent/20 text-accent',
};

const BADGE_MUTED_CLASS: Record<BadgeTone, string> = {
  [BADGE_TONE.NEUTRAL]: 'border-transparent bg-neutral/10 text-neutral/70',
  [BADGE_TONE.INFO]: 'border-transparent bg-info/10 text-info/70',
  [BADGE_TONE.SUCCESS]: 'border-transparent bg-success/10 text-success/70',
  [BADGE_TONE.WARNING]: 'border-transparent bg-warning/10 text-warning/70',
  [BADGE_TONE.DANGER]: 'border-transparent bg-danger/10 text-danger/70',
  [BADGE_TONE.ACCENT]: 'border-transparent bg-accent/10 text-accent/70',
};

export function Badge({
  children,
  tone = BADGE_TONE.NEUTRAL,
  size = BADGE_SIZE.SM,
  isMuted = false,
  icon,
  title,
  className,
}: BadgeProps) {
  const toneClassName = isMuted ? BADGE_MUTED_CLASS[tone] : BADGE_STRONG_CLASS[tone];

  return (
    <span
      title={title}
      className={mergeClassNames(
        BADGE_BASE_CLASS,
        BADGE_SIZE_CLASS[size],
        toneClassName,
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
