import type { ReactNode } from 'react';
import { Card, CARD_PADDING, CARD_TONE, type CardTone } from '@renderer/components/Card';
import { ChevronDownIcon } from '@renderer/components/icons/ChevronDownIcon';
import { ChevronRightIcon } from '@renderer/components/icons/ChevronRightIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useCollapsibleCard } from '@renderer/components/CollapsibleCard/useCollapsibleCard';

export interface CollapsibleCardProps {
  /** Stable across runs and comments — it is the key the open state is remembered under. */
  sectionId: string;
  heading: string;
  /**
   * One line standing in for the body while it is closed, so a collapsed section still
   * says whether it needs you. A section whose summary conveys nothing should not be
   * collapsible in the first place.
   */
  summary: string;
  /** Rendered in the header in both states, for a badge the summary cannot carry. */
  headerAccessory?: ReactNode;
  isDefaultOpen: boolean;
  tone?: CardTone;
  children: ReactNode;
}

const CHEVRON_SIZE = 12;
const HEADER_CLASS = joinClassNames(
  'flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left',
  'hover:bg-surface-hover',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
);
const HEADING_CLASS = 'text-ink shrink-0 text-sm font-semibold';
const SUMMARY_CLASS = 'text-muted min-w-0 flex-1 truncate text-xs';
const BODY_CLASS = 'flex flex-col gap-2';

/**
 * A card whose body folds away, so the pane can be reduced to the one part of the
 * review being worked on. The heading row is the control: a whole-width target rather
 * than a chevron you have to hit, since the row is what reads as clickable.
 */
export function CollapsibleCard({
  sectionId,
  heading,
  summary,
  headerAccessory,
  isDefaultOpen,
  tone = CARD_TONE.RAISED,
  children,
}: CollapsibleCardProps) {
  const { isOpen, onToggleClick, bodyId } = useCollapsibleCard({ sectionId, isDefaultOpen });

  const chevron = isOpen ? (
    <ChevronDownIcon size={CHEVRON_SIZE} />
  ) : (
    <ChevronRightIcon size={CHEVRON_SIZE} />
  );

  // The summary is the closed state's whole point, so it steps aside when the body it
  // stands in for is on screen.
  const summaryLine = isOpen ? null : <span className={SUMMARY_CLASS}>{summary}</span>;
  const body = isOpen ? (
    <div id={bodyId} className={BODY_CLASS}>
      {children}
    </div>
  ) : null;

  return (
    <Card tone={tone} padding={CARD_PADDING.SM} className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className={HEADER_CLASS}
        onClick={onToggleClick}
      >
        {chevron}
        <span className={HEADING_CLASS}>{heading}</span>
        {summaryLine}
        {headerAccessory}
      </button>
      {body}
    </Card>
  );
}
