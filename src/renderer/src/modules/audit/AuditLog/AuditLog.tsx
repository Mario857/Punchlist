import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { joinClassNames } from '@renderer/lib/classNames';
import { AuditLogEntry } from '@renderer/modules/audit/AuditLog/components/AuditLogEntry';
import { useAuditLog } from '@renderer/modules/audit/AuditLog/useAuditLog';

const SECTION_LABEL = 'Audit log';
const LIST_LABEL = 'Audit entries, newest first';

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADER_CLASS = 'flex items-center justify-between gap-2';
const HEADING_GROUP_CLASS = 'flex min-w-0 items-baseline gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const COUNT_CLASS = 'text-muted/80 text-xs tabular-nums';
const META_CLASS = 'text-muted text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

const LIST_CLASS = 'flex flex-col gap-2';
const GROUP_ENTRIES_CLASS = 'flex flex-col gap-1.5';
/** A standalone entry is its own group, so the wrapper adds spacing and nothing else. */
const STANDALONE_GROUP_CLASS = 'flex flex-col';
/**
 * A landing is one act made of several entries, so its group is framed and rules off to
 * the left: the rows inside it belong together even when they are minutes apart.
 */
const LANDING_GROUP_CLASS = joinClassNames(
  'flex flex-col gap-1.5 rounded-md border p-2',
  'border-accent/40 bg-accent/5 border-l-4',
);
const LANDING_HEADER_CLASS = 'flex flex-wrap items-baseline gap-2';
const LANDING_HEADING_CLASS = 'text-ink text-xs font-semibold tracking-wide uppercase';
const LANDING_ID_CLASS = 'text-muted font-mono text-xs';
const LANDING_COUNT_CLASS = 'text-muted/80 text-xs tabular-nums';

/**
 * The history of what Punchlist did to your repository. Entries of one landing are framed
 * together because a push, the threads it resolved and the replies it posted are one
 * act — reading them as unrelated rows loses the only question this view answers.
 */
export function AuditLog() {
  const {
    heading,
    explanation,
    countLabel,
    groups,
    statusLabel,
    auditEntriesErrorMessage,
    isRefreshingAuditEntries,
    refreshLabel,
    onRefreshClick,
  } = useAuditLog();

  const groupItems = groups.map((group) => {
    const groupClass = group.isLanding ? LANDING_GROUP_CLASS : STANDALONE_GROUP_CLASS;

    const landingHeader =
      group.landingHeader === null ? null : (
        <div className={LANDING_HEADER_CLASS}>
          <h4 className={LANDING_HEADING_CLASS}>{group.landingHeader.heading}</h4>
          <span className={LANDING_ID_CLASS} title={group.landingHeader.landingIdTitle}>
            {group.landingHeader.shortLandingId}
          </span>
          <span className={LANDING_COUNT_CLASS}>{group.landingHeader.countLabel}</span>
        </div>
      );

    const entryItems = group.entries.map((entry) => <AuditLogEntry key={entry.id} item={entry} />);

    return (
      <li key={group.id} className={groupClass}>
        {landingHeader}
        <ol className={GROUP_ENTRIES_CLASS}>{entryItems}</ol>
      </li>
    );
  });

  const status =
    statusLabel === null ? null : (
      <p role="status" className={META_CLASS}>
        {statusLabel}
      </p>
    );

  const auditEntriesError =
    auditEntriesErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {auditEntriesErrorMessage}
      </p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD}>
      <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
        <header className={HEADER_CLASS}>
          <div className={HEADING_GROUP_CLASS}>
            <h3 className={HEADING_CLASS}>{heading}</h3>
            <span className={COUNT_CLASS}>{countLabel}</span>
          </div>
          <IconButton
            label={refreshLabel}
            icon={<RefreshIcon />}
            size={ICON_BUTTON_SIZE.SM}
            isLoading={isRefreshingAuditEntries}
            onClick={onRefreshClick}
          />
        </header>
        <p className={META_CLASS}>{explanation}</p>
        {status}
        {auditEntriesError}
        <ol aria-label={LIST_LABEL} className={LIST_CLASS}>
          {groupItems}
        </ol>
      </section>
    </Card>
  );
}
