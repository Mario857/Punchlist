import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function FlagIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path d="M4 1.5h1.5v13H4Z" />
      <path d="M6.5 2.5H13l-2 2.75L13 8H6.5Z" />
    </svg>
  );
}
