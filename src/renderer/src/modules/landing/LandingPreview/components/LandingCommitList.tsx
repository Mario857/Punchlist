import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { LandingCommentLink } from '@renderer/modules/landing/LandingPreview/components/LandingCommentLink';
import type { LandingCommitsView } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

interface Props {
  view: LandingCommitsView;
}

const FIELD_CLASS = joinClassNames(
  'border-border bg-surface text-ink w-full rounded-md border p-2',
  'text-xs leading-relaxed',
  'placeholder:text-muted/70',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const COLUMN_CLASS = 'flex flex-col gap-3';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const LIST_CLASS = 'flex flex-col gap-3';
const EMPTY_MERGE_CLASS = 'text-warning text-xs leading-relaxed';
const ITEM_CLASS = 'border-border bg-surface flex flex-col gap-1.5 rounded-md border p-2';
const ITEM_HEADER_CLASS = 'flex flex-wrap items-baseline gap-2';
const COMMENT_LABEL_CLASS = 'text-ink min-w-0 flex-1 text-xs font-semibold';
const FIELD_LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const EMPTY_CLASS = 'text-muted text-xs leading-relaxed';

/**
 * The messages are editable here rather than in a step of their own: the agent wrote
 * its summary before the patch was hand-edited, so the correction belongs beside the
 * confirmation that will commit it.
 */
export function LandingCommitList({ view }: Props) {
  const items = view.items.map((item) => (
    <li key={item.runId} className={ITEM_CLASS}>
      <div className={ITEM_HEADER_CLASS}>
        <h4 id={item.commentFieldId} className={COMMENT_LABEL_CLASS}>
          {item.commentLabel}
        </h4>
        <LandingCommentLink url={item.commentUrl} label={item.commentLinkLabel} />
      </div>
      <label htmlFor={item.subjectFieldId} className={FIELD_LABEL_CLASS}>
        {item.subjectLabel}
      </label>
      <input
        id={item.subjectFieldId}
        type="text"
        value={item.subjectValue}
        aria-describedby={item.commentFieldId}
        onChange={item.onSubjectChange}
        className={FIELD_CLASS}
      />
      <label htmlFor={item.bodyFieldId} className={FIELD_LABEL_CLASS}>
        {item.bodyLabel}
      </label>
      <textarea
        id={item.bodyFieldId}
        rows={item.bodyRowCount}
        value={item.bodyValue}
        aria-describedby={item.commentFieldId}
        onChange={item.onBodyChange}
        className={FIELD_CLASS}
      />
    </li>
  ));

  const body = view.hasCommits ? (
    <ul aria-label={view.heading} className={LIST_CLASS}>
      {items}
    </ul>
  ) : (
    <p className={EMPTY_CLASS}>{view.emptyLabel}</p>
  );

  const emptyMergeLines = view.emptyMergeItems.map((item) => (
    <p key={item.runId} role="status" className={EMPTY_MERGE_CLASS}>
      {item.label}
    </p>
  ));

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <div>
        <h3 className={HEADING_CLASS}>{view.heading}</h3>
        <p className={EXPLANATION_CLASS}>{view.explanation}</p>
      </div>
      {body}
      {emptyMergeLines}
    </Card>
  );
}
