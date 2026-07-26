import { ExternalLinkIcon } from '@renderer/components/icons/ExternalLinkIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';

interface Props {
  /** Null when the comment is not in the fetched set, which leaves nothing to link to. */
  url: string | null;
  label: string;
}

const EXTERNAL_LINK_ICON_SIZE = 12;

const LINK_CLASS = joinClassNames(
  'text-muted hover:text-ink inline-flex items-center gap-1 rounded text-xs',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
);

/** A plain anchor: main routes every new-window request to the system browser. */
export function LandingCommentLink({ url, label }: Props) {
  if (url === null) return null;

  return (
    <a href={url} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      {label}
      <ExternalLinkIcon size={EXTERNAL_LINK_ICON_SIZE} />
    </a>
  );
}
