import { Badge, type BadgeTone } from '@renderer/components/Badge';
import { joinClassNames } from '@renderer/lib/classNames';

/** One `dt`/`dd` pair: the facts that make an entry actionable rather than decorative. */
export interface AuditLogFactItem {
  id: string;
  label: string;
  value: string;
  /** Ids, branches and remotes are strings you retype into git, so they read as code. */
  isMonospace: boolean;
}

export interface AuditLogEntryItem {
  id: string;
  actionLabel: string;
  /** What that action actually did, so a row is never a bare verb. */
  actionExplanation: string;
  actionTone: BadgeTone;
  /**
   * Reaching outside the sandbox is the point of this log, so those rows carry the only
   * strong badges here and the ones that merely authorised them stay muted.
   */
  isActionBadgeMuted: boolean;
  isOutsideSandbox: boolean;
  /** Says in words what the badge weight says in colour — never colour alone. */
  reachLabel: string;
  summary: string;
  /** The machine-readable timestamp for `<time dateTime>`. */
  timestamp: string;
  /** Relative for scanning; the absolute form is the accessible name beside it. */
  relativeLabel: string;
  absoluteLabel: string;
  facts: AuditLogFactItem[];
  hasFacts: boolean;
}

export interface AuditLogEntryProps {
  item: AuditLogEntryItem;
}

const ITEM_COMMON_CLASS = 'flex flex-col gap-1.5 rounded-md border p-2';
const OUTSIDE_ITEM_CLASS = joinClassNames(ITEM_COMMON_CLASS, 'border-border bg-surface');
/** Dashed and quieter, so an in-sandbox authorisation never reads as a repo change. */
const AUTHORISATION_ITEM_CLASS = joinClassNames(
  ITEM_COMMON_CLASS,
  'border-border bg-surface-raised border-dashed',
);

const HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const REACH_OUTSIDE_CLASS = 'text-ink text-xs font-medium';
const REACH_AUTHORISATION_CLASS = 'text-muted text-xs';
const TIME_CLASS = 'text-muted ml-auto text-xs';
const SCREEN_READER_ONLY_CLASS = 'sr-only';
const SUMMARY_CLASS = 'text-ink text-sm leading-relaxed break-words';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';

const FACTS_CLASS = 'flex flex-col gap-1';
const FACT_CLASS = 'flex flex-wrap items-baseline gap-2';
const FACT_LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const FACT_VALUE_CLASS = 'text-ink min-w-0 text-xs break-words';
const FACT_MONO_VALUE_CLASS = joinClassNames(FACT_VALUE_CLASS, 'font-mono');

/**
 * One entry of the audit log. The relative time is rendered for scanning with the
 * absolute time beside it in a screen-reader-only span rather than only in the tooltip:
 * a `title` is not reliably announced, and "2d ago" is the one label in this view that
 * a reader cannot resolve for themselves.
 */
export function AuditLogEntry({ item }: AuditLogEntryProps) {
  const itemClass = item.isOutsideSandbox ? OUTSIDE_ITEM_CLASS : AUTHORISATION_ITEM_CLASS;
  const reachClass = item.isOutsideSandbox ? REACH_OUTSIDE_CLASS : REACH_AUTHORISATION_CLASS;

  const factRows = item.facts.map((fact) => {
    const valueClass = fact.isMonospace ? FACT_MONO_VALUE_CLASS : FACT_VALUE_CLASS;
    return (
      <div key={fact.id} className={FACT_CLASS}>
        <dt className={FACT_LABEL_CLASS}>{fact.label}</dt>
        <dd className={valueClass}>{fact.value}</dd>
      </div>
    );
  });

  const facts = item.hasFacts ? <dl className={FACTS_CLASS}>{factRows}</dl> : null;

  return (
    <li className={itemClass}>
      <div className={HEADER_CLASS}>
        <Badge tone={item.actionTone} isMuted={item.isActionBadgeMuted}>
          {item.actionLabel}
        </Badge>
        <span className={reachClass}>{item.reachLabel}</span>
        <time dateTime={item.timestamp} title={item.absoluteLabel} className={TIME_CLASS}>
          <span aria-hidden="true">{item.relativeLabel}</span>
          <span className={SCREEN_READER_ONLY_CLASS}>{item.absoluteLabel}</span>
        </time>
      </div>
      <p className={SUMMARY_CLASS}>{item.summary}</p>
      <p className={EXPLANATION_CLASS}>{item.actionExplanation}</p>
      {facts}
    </li>
  );
}
