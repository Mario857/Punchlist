import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function RefreshIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path d="M5.05 2.89A5.9 5.9 0 1 0 10.95 2.89L10.05 4.45A4.1 4.1 0 1 1 5.95 4.45Z" />
      <path d="M8.25 2.37 11.55 1.85 9.45 5.49Z" />
    </svg>
  );
}
