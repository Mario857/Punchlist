import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import type { LandingTargetView } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

interface Props {
  view: LandingTargetView;
}

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const LIST_CLASS = 'flex flex-col gap-1';
const ROW_CLASS = 'flex flex-wrap items-baseline gap-2';
const TERM_CLASS = 'text-muted w-64 shrink-0 text-xs';
const VALUE_CLASS = 'text-ink min-w-0 flex-1 font-mono text-xs break-words';

/** Where the landing goes, stated before what it contains. */
export function LandingTargetCard({ view }: Props) {
  const rows = view.items.map((item) => (
    <div key={item.key} className={ROW_CLASS}>
      <dt className={TERM_CLASS}>{item.label}</dt>
      <dd className={VALUE_CLASS}>{item.value}</dd>
    </div>
  ));

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <h3 className={HEADING_CLASS}>{view.heading}</h3>
      <dl className={LIST_CLASS}>{rows}</dl>
      <p className={EXPLANATION_CLASS}>{view.explanation}</p>
    </Card>
  );
}
