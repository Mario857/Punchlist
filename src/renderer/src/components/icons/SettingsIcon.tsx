import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

export function SettingsIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <rect x="1.5" y="3.2" width="13" height="1.2" rx="0.6" />
      <circle cx="10.8" cy="3.8" r="2.2" />
      <rect x="1.5" y="7.4" width="13" height="1.2" rx="0.6" />
      <circle cx="5.2" cy="8" r="2.2" />
      <rect x="1.5" y="11.6" width="13" height="1.2" rx="0.6" />
      <circle cx="9.4" cy="12.2" r="2.2" />
    </svg>
  );
}
