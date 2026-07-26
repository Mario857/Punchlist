import { mergeClassNames } from '@renderer/lib/classNames';

export const SPINNER_SIZE = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
} as const;

export type SpinnerSize = (typeof SPINNER_SIZE)[keyof typeof SPINNER_SIZE];

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Announced by the status role, so a spinner is never a silent wait. */
  label?: string;
  className?: string;
}

const SPINNER_DEFAULT_LABEL = 'Loading';

const SPINNER_SIZE_CLASS: Record<SpinnerSize, string> = {
  [SPINNER_SIZE.SM]: 'size-3 border',
  [SPINNER_SIZE.MD]: 'size-4 border-2',
  [SPINNER_SIZE.LG]: 'size-6 border-2',
};

/**
 * A bordered ring rather than an SVG: `border-current` inherits the text colour of
 * whatever it sits in, so a spinner inside a primary Button needs no variant axis.
 */
export function Spinner({
  size = SPINNER_SIZE.MD,
  label = SPINNER_DEFAULT_LABEL,
  className,
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={mergeClassNames(
        'inline-block shrink-0 rounded-full',
        'border-current border-t-transparent',
        'animate-spin',
        SPINNER_SIZE_CLASS[size],
        className,
      )}
    />
  );
}
