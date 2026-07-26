import type { ReactNode, Ref } from 'react';
import { mergeClassNames } from '@renderer/lib/classNames';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  BUTTON_VARIANT_CLASS,
  type ButtonType,
  type ButtonVariant,
} from '@renderer/components/Button';
import { Spinner, SPINNER_SIZE, type SpinnerSize } from '@renderer/components/Spinner';

export const ICON_BUTTON_SIZE = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
} as const;

export type IconButtonSize = (typeof ICON_BUTTON_SIZE)[keyof typeof ICON_BUTTON_SIZE];

export interface IconButtonProps {
  /** An icon-only control has no text, so the accessible name is required, not optional. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: IconButtonSize;
  type?: ButtonType;
  isDisabled?: boolean;
  isLoading?: boolean;
  /** Set for toggle-style controls (a filter that stays on) so state is announced. */
  isPressed?: boolean;
  onClick?: () => void;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

const ICON_BUTTON_SIZE_CLASS: Record<IconButtonSize, string> = {
  [ICON_BUTTON_SIZE.SM]: 'size-7',
  [ICON_BUTTON_SIZE.MD]: 'size-9',
  [ICON_BUTTON_SIZE.LG]: 'size-11',
};

const ICON_BUTTON_SPINNER_SIZE: Record<IconButtonSize, SpinnerSize> = {
  [ICON_BUTTON_SIZE.SM]: SPINNER_SIZE.SM,
  [ICON_BUTTON_SIZE.MD]: SPINNER_SIZE.SM,
  [ICON_BUTTON_SIZE.LG]: SPINNER_SIZE.MD,
};

export function IconButton({
  label,
  icon,
  variant = BUTTON_VARIANT.GHOST,
  size = ICON_BUTTON_SIZE.MD,
  type = BUTTON_TYPE.BUTTON,
  isDisabled = false,
  isLoading = false,
  isPressed,
  onClick,
  className,
  ref,
}: IconButtonProps) {
  const isInteractionBlocked = isDisabled || isLoading;
  const content = isLoading ? (
    <Spinner size={ICON_BUTTON_SPINNER_SIZE[size]} label={label} />
  ) : (
    icon
  );

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={isPressed}
      aria-busy={isLoading}
      title={label}
      disabled={isInteractionBlocked}
      onClick={onClick}
      className={mergeClassNames(
        'inline-flex shrink-0 items-center justify-center rounded-md',
        ICON_BUTTON_SIZE_CLASS[size],
        BUTTON_VARIANT_CLASS[variant],
        FOCUS_RING,
        INTERACTIVE_TRANSITION,
        DISABLED_STATE,
        className,
      )}
    >
      {content}
    </button>
  );
}
