import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function ChevronRightIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path d="M6.1 2.8 4.7 4.2 8.5 8 4.7 11.8 6.1 13.2 11.3 8Z" />
    </svg>
  );
}
