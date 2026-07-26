import type { ReactNode, Ref } from 'react';
import { mergeClassNames } from '@renderer/lib/classNames';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { Spinner, SPINNER_SIZE, type SpinnerSize } from '@renderer/components/Spinner';

export const BUTTON_VARIANT = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  GHOST: 'ghost',
  DANGER: 'danger',
} as const;

export type ButtonVariant = (typeof BUTTON_VARIANT)[keyof typeof BUTTON_VARIANT];

export const BUTTON_SIZE = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
} as const;

export type ButtonSize = (typeof BUTTON_SIZE)[keyof typeof BUTTON_SIZE];

export const BUTTON_TYPE = {
  BUTTON: 'button',
  SUBMIT: 'submit',
  RESET: 'reset',
} as const;

export type ButtonType = (typeof BUTTON_TYPE)[keyof typeof BUTTON_TYPE];

export interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: ButtonType;
  isDisabled?: boolean;
  isLoading?: boolean;
  /** Rendered before the label; use an icon component, never an inline SVG. */
  icon?: ReactNode;
  /** Set only on a disclosure, where the button owns the region it opens. */
  isExpanded?: boolean;
  title?: string;
  onClick?: () => void;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Exported so IconButton renders the same four variants from one source. Its size
 * axis is square and therefore its own, but the colours must not drift.
 */
export const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  [BUTTON_VARIANT.PRIMARY]: 'bg-accent text-bg-0 hover:bg-accent/85 active:bg-accent/75',
  [BUTTON_VARIANT.SECONDARY]:
    'border border-border bg-surface-raised text-ink hover:border-border-strong hover:bg-surface-hover',
  [BUTTON_VARIANT.GHOST]: 'text-muted hover:bg-surface-hover hover:text-ink',
  [BUTTON_VARIANT.DANGER]: 'bg-danger text-bg-0 hover:bg-danger/85 active:bg-danger/75',
};

const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  [BUTTON_SIZE.SM]: 'h-7 gap-1.5 px-2.5 text-xs',
  [BUTTON_SIZE.MD]: 'h-9 gap-2 px-3.5 text-sm',
  [BUTTON_SIZE.LG]: 'h-11 gap-2 px-5 text-base',
};

const BUTTON_SPINNER_SIZE: Record<ButtonSize, SpinnerSize> = {
  [BUTTON_SIZE.SM]: SPINNER_SIZE.SM,
  [BUTTON_SIZE.MD]: SPINNER_SIZE.SM,
  [BUTTON_SIZE.LG]: SPINNER_SIZE.MD,
};

export function Button({
  children,
  variant = BUTTON_VARIANT.SECONDARY,
  size = BUTTON_SIZE.MD,
  type = BUTTON_TYPE.BUTTON,
  isDisabled = false,
  isLoading = false,
  icon,
  isExpanded,
  title,
  onClick,
  className,
  ref,
}: ButtonProps) {
  const isInteractionBlocked = isDisabled || isLoading;
  const leading = isLoading ? <Spinner size={BUTTON_SPINNER_SIZE[size]} /> : icon;

  return (
    <button
      ref={ref}
      type={type}
      title={title}
      disabled={isInteractionBlocked}
      aria-busy={isLoading}
      aria-expanded={isExpanded}
      onClick={onClick}
      className={mergeClassNames(
        'inline-flex shrink-0 items-center justify-center rounded-md',
        'font-medium whitespace-nowrap select-none',
        BUTTON_SIZE_CLASS[size],
        BUTTON_VARIANT_CLASS[variant],
        FOCUS_RING,
        INTERACTIVE_TRANSITION,
        DISABLED_STATE,
        className,
      )}
    >
      {leading}
      {children}
    </button>
  );
}
