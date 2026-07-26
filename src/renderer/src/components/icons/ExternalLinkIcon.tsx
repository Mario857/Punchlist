import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function ExternalLinkIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path d="M2 4H8V5.5H3.5V12.5H10.5V8H12V14H2Z" />
      <path d="M9.5 1.5H14.5V6.5H12.7V3.3H9.5Z" />
      <rect x="6.965" y="4.6" width="7.07" height="1.8" rx="0.9" transform="rotate(-45 10.5 5.5)" />
    </svg>
  );
}
