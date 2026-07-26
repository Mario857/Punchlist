import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function ChevronDownIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path d="M13.2 6.1 11.8 4.7 8 8.5 4.2 4.7 2.8 6.1 8 11.3Z" />
    </svg>
  );
}
