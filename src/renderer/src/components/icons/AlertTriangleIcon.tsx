import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

/** Guardrail flags are rare and loud, so this is the one deliberately alarming glyph. */
export function AlertTriangleIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <path fillRule="evenodd" d="M8 1.4 15.4 14.6H0.6ZM7.1 5.9h1.8v4.2H7.1Zm0 5.3h1.8V13H7.1Z" />
    </svg>
  );
}
