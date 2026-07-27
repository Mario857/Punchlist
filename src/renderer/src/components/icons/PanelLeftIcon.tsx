import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

/** A window frame with its left panel filled — the comment list's side of the layout. */
export function PanelLeftIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
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
        d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9A1.5 1.5 0 0 1 2.5 2ZM7 3.5h6.5v9H7v-9Z"
      />
    </svg>
  );
}
