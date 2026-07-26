import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

/** The indeterminate state of a multi-select checkbox: some descendants selected. */
export function MinusIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <rect x="3" y="7.1" width="10" height="1.8" rx="0.9" />
    </svg>
  );
}
