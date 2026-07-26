import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function CheckIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path d="M2.49 8.91 6.3 12.72 13.51 5.51 12.09 4.09 6.3 9.88 3.91 7.49Z" />
    </svg>
  );
}
