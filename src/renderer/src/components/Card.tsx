import type { ReactNode, Ref } from 'react';
import { mergeClassNames } from '@renderer/lib/classNames';

export const CARD_PADDING = {
  NONE: 'none',
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
} as const;

export type CardPadding = (typeof CARD_PADDING)[keyof typeof CARD_PADDING];

export const CARD_TONE = {
  DEFAULT: 'default',
  RAISED: 'raised',
} as const;

export type CardTone = (typeof CARD_TONE)[keyof typeof CARD_TONE];

export interface CardProps {
  children: ReactNode;
  padding?: CardPadding;
  tone?: CardTone;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

const CARD_PADDING_CLASS: Record<CardPadding, string> = {
  [CARD_PADDING.NONE]: 'p-0',
  [CARD_PADDING.SM]: 'p-2',
  [CARD_PADDING.MD]: 'p-4',
  [CARD_PADDING.LG]: 'p-6',
};

const CARD_TONE_CLASS: Record<CardTone, string> = {
  [CARD_TONE.DEFAULT]: 'bg-surface',
  [CARD_TONE.RAISED]: 'bg-surface-raised',
};

export function Card({
  children,
  padding = CARD_PADDING.MD,
  tone = CARD_TONE.DEFAULT,
  className,
  ref,
}: CardProps) {
  return (
    <div
      ref={ref}
      className={mergeClassNames(
        'border-border rounded-lg border',
        CARD_PADDING_CLASS[padding],
        CARD_TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
