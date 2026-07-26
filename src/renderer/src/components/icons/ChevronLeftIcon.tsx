import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function ChevronLeftIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path d="M9.9 2.8 11.3 4.2 7.5 8 11.3 11.8 9.9 13.2 4.7 8Z" />
    </svg>
  );
}
