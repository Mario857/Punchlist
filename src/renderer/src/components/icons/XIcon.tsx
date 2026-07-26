import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function XIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <rect x="3" y="7.1" width="10" height="1.8" rx="0.9" transform="rotate(45 8 8)" />
      <rect x="3" y="7.1" width="10" height="1.8" rx="0.9" transform="rotate(-45 8 8)" />
    </svg>
  );
}
