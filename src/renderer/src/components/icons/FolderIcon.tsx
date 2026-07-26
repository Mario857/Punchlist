import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function FolderIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path d="M1.5 3H6.2L7.7 4.8H14.5V13H1.5Z" />
    </svg>
  );
}
