import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function SearchIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
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
        d="M6.75 1.5a5.25 5.25 0 1 0 0 10.5a5.25 5.25 0 0 0 0-10.5Zm0 1.85a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 0 0 0-6.8Z"
      />
      <rect
        x="9.655"
        y="11.25"
        width="5.09"
        height="1.9"
        rx="0.95"
        transform="rotate(45 12.2 12.2)"
      />
    </svg>
  );
}
