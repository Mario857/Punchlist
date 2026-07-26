import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function FileIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path fillRule="evenodd" d="M3 1.5H9.5L13 5V14.5H3ZM9.9 2.9V4.6H11.6Z" />
    </svg>
  );
}
