import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { ExternalLinkIcon } from '@renderer/components/icons/ExternalLinkIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import type { LandingThreadsView } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

interface Props {
  view: LandingThreadsView;
}

const EXTERNAL_LINK_ICON_SIZE = 12;

const COLUMN_CLASS = 'flex flex-col gap-3';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const SUB_HEADING_CLASS = 'text-ink text-xs font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const LIST_CLASS = 'flex flex-col gap-1';
const REPLY_CLASS =
  'border-border bg-surface text-ink rounded-md border p-2 text-xs leading-relaxed break-words whitespace-pre-wrap';

const THREAD_LINK_CLASS = joinClassNames(
  'text-muted hover:text-ink inline-flex items-center gap-1 rounded font-mono text-xs break-all',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
);

/**
 * Listed by URL rather than counted: a count is not something you can check, and every
 * one of these is a write to GitHub that only your confirmation authorises.
 */
export function LandingThreadList({ view }: Props) {
  const items = view.items.map((item) => (
    <li key={item.threadId}>
      {/* A plain anchor: main routes every new-window request to the system browser. */}
      <a href={item.url} target="_blank" rel="noreferrer" className={THREAD_LINK_CLASS}>
        {item.url}
        <ExternalLinkIcon size={EXTERNAL_LINK_ICON_SIZE} />
      </a>
    </li>
  ));

  const threads = view.hasThreads ? (
    <ul aria-label={view.heading} className={LIST_CLASS}>
      {items}
    </ul>
  ) : (
    <p className={EXPLANATION_CLASS}>{view.emptyLabel}</p>
  );

  // An absent reply is stated rather than rendered as a blank section: "nothing will be
  // posted" is the fact that matters, since a posted comment cannot be unposted.
  const reply =
    view.replyText === null ? (
      <p className={EXPLANATION_CLASS}>{view.noReplyLabel}</p>
    ) : (
      <p className={REPLY_CLASS}>{view.replyText}</p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <div>
        <h3 className={HEADING_CLASS}>{view.heading}</h3>
        <p className={EXPLANATION_CLASS}>{view.explanation}</p>
      </div>
      {threads}
      <h4 className={SUB_HEADING_CLASS}>{view.replyHeading}</h4>
      {reply}
    </Card>
  );
}
