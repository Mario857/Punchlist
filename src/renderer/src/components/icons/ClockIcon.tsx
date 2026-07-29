import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function ClockIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Z"
      />
      <path d="M7.35 4.2h1.3v3.7l2.6 1.5-.65 1.15-3.25-1.9Z" />
    </svg>
  );
}
