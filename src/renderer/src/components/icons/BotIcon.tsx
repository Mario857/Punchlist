import { ICON_SIZE, ICON_VIEW_BOX, type IconProps } from './iconProps';

/** Marks a bot-authored comment; renders muted, since author identity is secondary. */
export function BotIcon({ size = ICON_SIZE, className, isAriaHidden = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={isAriaHidden}
      className={className}
    >
      <circle cx="8" cy="2" r="1.3" />
      <rect x="7.4" y="2.6" width="1.2" height="2.6" rx="0.6" />
      <path
        fillRule="evenodd"
        d="M4.5 5h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1.3 3.2a1.15 1.15 0 1 0 0 2.3a1.15 1.15 0 0 0 0-2.3Zm4.4 0a1.15 1.15 0 1 0 0 2.3a1.15 1.15 0 0 0 0-2.3Z"
      />
    </svg>
  );
}
