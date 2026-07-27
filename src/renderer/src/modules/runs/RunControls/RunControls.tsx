import type { PrRef } from '@shared/discovery';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { StateBadge } from '@renderer/components/StateBadge';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { ChevronDownIcon } from '@renderer/components/icons/ChevronDownIcon';
import { ChevronRightIcon } from '@renderer/components/icons/ChevronRightIcon';
import { XIcon } from '@renderer/components/icons/XIcon';
import { AutoModeToggle } from '@renderer/modules/runs/AutoModeToggle/AutoModeToggle';
import { BatchTierPicker } from '@renderer/modules/runs/RunControls/components/BatchTierPicker/BatchTierPicker';
import { useRunControls } from '@renderer/modules/runs/RunControls/useRunControls';

export interface RunControlsProps {
  /** Null before a PR is chosen: a run needs a local clone to build its worktree from. */
  prRef: PrRef | null;
}

const SECTION_LABEL = 'Run controls';
const BULK_REVIEW_HEADING = 'Bulk review';
const SECOND_OPINION_HEADING = 'Second opinion';
const SANDBOX_HEADING = 'Sandbox';
const CLEANUP_LABEL = 'Clean up finished';
const CANCEL_LABEL_PREFIX = 'Cancel ';
const SANDBOX_LOADING_LABEL = 'Measuring sandbox…';
const SANDBOX_SEPARATOR = ' · ';

const AUTO_TRIGGER_LABEL = 'Auto';
const AUTO_TRIGGER_TITLE = 'Started by automation from an allowlisted author, not by you';
const STALE_LABEL = 'Stale';
const STALE_TITLE =
  'The PR head moved after this run started, so its patch is against code that is no longer current';

const CANCEL_ICON_SIZE = 11;
const DISCLOSURE_ICON_SIZE = 12;
const ATTENTION_ICON_SIZE = 12;
/** Matches the comment tree's row glyphs, so a badge means the same thing in both panes. */
const ROW_ALERT_ICON_SIZE = 11;

const ROW_CLASS = 'flex items-center gap-2';
/** One row per block: the label leads, the controls follow, prose lives in titles. */
const BLOCK_ROW_CLASS = 'flex flex-wrap items-center gap-x-3 gap-y-1.5';
const TRAILING_GROUP_CLASS = 'ml-auto flex items-center gap-2';
const META_CLASS = 'text-muted text-xs';
const ALERT_CLASS = 'text-danger text-xs leading-relaxed';
const WARNING_CLASS = 'text-warning flex items-start gap-1.5 text-xs leading-relaxed';
const ACTIVE_RUN_ROW_CLASS = 'bg-surface-raised flex items-center gap-2 rounded-md px-1.5 py-1';
const ACTIVE_RUN_LABEL_CLASS = 'text-ink min-w-0 flex-1 truncate text-xs';
const BLOCK_HEADING_CLASS = 'text-ink text-xs font-medium';
const BLOCK_COLUMN_CLASS = 'flex flex-col gap-1.5';

export function RunControls({ prRef }: RunControlsProps) {
  const {
    startLabel,
    isStartDisabled,
    isStartRunsPending,
    startErrorMessage,
    selectedCommentIds,
    hasSelection,
    poolSpendingMessage,
    costUnknownMessage,
    activeRunItems,
    hasActiveRuns,
    isCancelRunPending,
    cancelErrorMessage,
    stopAllLabel,
    isStopAllRunsPending,
    stopAllErrorMessage,
    onStopAllClick,
    isExpanded,
    expandLabel,
    onToggleExpandedClick,
    isBulkReviewVisible,
    bulkApproveLabel,
    isBulkApproveDisabled,
    isBulkApprovePending,
    bulkApproveNote,
    bulkApproveErrorMessage,
    bulkRejectLabel,
    isBulkRejectDisabled,
    isBulkRejectPending,
    bulkRejectErrorMessage,
    onBulkApproveClick,
    onBulkRejectClick,
    isSecondOpinionVisible,
    isSandboxSummaryVisible,
    secondOpinionLabel,
    isSecondOpinionDisabled,
    isSecondOpinionPending,
    secondOpinionCostNote,
    secondOpinionAdvisoryNote,
    secondOpinionReviewedMessage,
    secondOpinionErrorMessage,
    onSecondOpinionClick,
    sandboxUsageLabel,
    sandboxWorktreeLabel,
    isSandboxUsageLoading,
    isCleanupDisabled,
    isSandboxCleanupPending,
    cleanupAttentionMessage,
    onStartClick,
    onCleanupClick,
    onAutoModeEnabled,
  } = useRunControls({ prRef });

  const activeRunRows = activeRunItems.map((item) => {
    // Muted and only when true: StateBadge stays the row's one strong signal, and
    // provenance is exactly the kind of secondary attribute that budget is for.
    const autoBadge = item.isAutoTriggered ? (
      <Badge tone={BADGE_TONE.NEUTRAL} isMuted title={AUTO_TRIGGER_TITLE}>
        {AUTO_TRIGGER_LABEL}
      </Badge>
    ) : null;

    // Staleness gets more weight than provenance because it is a trap rather than a
    // fact: the run reads as landable while its patch is against a head that moved.
    const staleBadge = item.isStale ? (
      <Badge
        tone={BADGE_TONE.WARNING}
        title={STALE_TITLE}
        icon={<AlertTriangleIcon size={ROW_ALERT_ICON_SIZE} />}
      >
        {STALE_LABEL}
      </Badge>
    ) : null;

    return (
      <li key={item.runId} className={ACTIVE_RUN_ROW_CLASS}>
        <StateBadge state={item.state} />
        <span className={ACTIVE_RUN_LABEL_CLASS} title={item.label}>
          {item.label}
        </span>
        {staleBadge}
        {autoBadge}
        <IconButton
          label={`${CANCEL_LABEL_PREFIX}${item.label}`}
          icon={<XIcon size={CANCEL_ICON_SIZE} />}
          size={ICON_BUTTON_SIZE.SM}
          isDisabled={isCancelRunPending}
          onClick={item.onCancelClick}
        />
      </li>
    );
  });

  const activeRunList = hasActiveRuns ? (
    <ul className="flex flex-col gap-1">{activeRunRows}</ul>
  ) : null;

  // Halting everything only exists while there is something to halt, and it is the
  // one control here that destroys work in flight.
  const stopAllButton = hasActiveRuns ? (
    <Button
      variant={BUTTON_VARIANT.DANGER}
      size={BUTTON_SIZE.SM}
      isLoading={isStopAllRunsPending}
      onClick={onStopAllClick}
    >
      {stopAllLabel}
    </Button>
  ) : null;

  const batchTierPicker = hasSelection ? (
    <BatchTierPicker selectedCommentIds={selectedCommentIds} />
  ) : null;

  // Stated, not gated: the pool-spending choice was made in Settings, so the batch
  // says what it will cost and starts when told to.
  const poolSpendingNotice =
    poolSpendingMessage === null ? null : (
      <p role="alert" className={WARNING_CLASS}>
        <AlertTriangleIcon size={ATTENTION_ICON_SIZE} className="mt-0.5 shrink-0" />
        {poolSpendingMessage}
      </p>
    );

  const costUnknownNotice =
    costUnknownMessage === null ? null : <p className={META_CLASS}>{costUnknownMessage}</p>;

  const startError =
    startErrorMessage === null ? null : (
      <p role="alert" className={ALERT_CLASS}>
        {startErrorMessage}
      </p>
    );

  const cancelError =
    cancelErrorMessage === null ? null : (
      <p role="alert" className={ALERT_CLASS}>
        {cancelErrorMessage}
      </p>
    );

  const stopAllError =
    stopAllErrorMessage === null ? null : (
      <p role="alert" className={ALERT_CLASS}>
        {stopAllErrorMessage}
      </p>
    );

  const bulkApproveError =
    bulkApproveErrorMessage === null ? null : (
      <p role="alert" className={ALERT_CLASS}>
        {bulkApproveErrorMessage}
      </p>
    );

  const bulkRejectError =
    bulkRejectErrorMessage === null ? null : (
      <p role="alert" className={ALERT_CLASS}>
        {bulkRejectErrorMessage}
      </p>
    );

  // Reviewing one run at a time stays the default, so neither of these is the loud
  // button in this card. Nothing here reaches the landing gate: a bulk approve only
  // ever moves records to approved, which is what the note beneath it says.
  // One row, with the boundary copy as hover detail on the buttons it describes:
  // warnings and errors still get their own visible lines below.
  const bulkReview = isBulkReviewVisible ? (
    <div className={BLOCK_COLUMN_CLASS}>
      <div className={BLOCK_ROW_CLASS}>
        <p className={BLOCK_HEADING_CLASS}>{BULK_REVIEW_HEADING}</p>
        <Button
          variant={BUTTON_VARIANT.SECONDARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isBulkApproveDisabled}
          isLoading={isBulkApprovePending}
          title={bulkApproveNote}
          onClick={onBulkApproveClick}
        >
          {bulkApproveLabel}
        </Button>
        <Button
          variant={BUTTON_VARIANT.SECONDARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isBulkRejectDisabled}
          isLoading={isBulkRejectPending}
          title={bulkApproveNote}
          onClick={onBulkRejectClick}
        >
          {bulkRejectLabel}
        </Button>
      </div>
      {bulkApproveError}
      {bulkRejectError}
    </div>
  ) : null;

  const secondOpinionReviewed =
    secondOpinionReviewedMessage === null ? null : (
      <p className={META_CLASS}>{secondOpinionReviewedMessage}</p>
    );
  const secondOpinionTitle = `${secondOpinionCostNote}\n\n${secondOpinionAdvisoryNote}`;

  const secondOpinionError =
    secondOpinionErrorMessage === null ? null : (
      <p role="alert" className={ALERT_CLASS}>
        {secondOpinionErrorMessage}
      </p>
    );

  // Secondary like the bulk decisions, and for a sharper reason: this one spends an
  // agent per run, so it must not read as the obvious thing to press.
  const secondOpinionBatch = isSecondOpinionVisible ? (
    <div className={BLOCK_COLUMN_CLASS}>
      <div className={BLOCK_ROW_CLASS}>
        <p className={BLOCK_HEADING_CLASS}>{SECOND_OPINION_HEADING}</p>
        <Button
          variant={BUTTON_VARIANT.SECONDARY}
          size={BUTTON_SIZE.SM}
          isDisabled={isSecondOpinionDisabled}
          isLoading={isSecondOpinionPending}
          title={secondOpinionTitle}
          onClick={onSecondOpinionClick}
        >
          {secondOpinionLabel}
        </Button>
        {secondOpinionReviewed}
      </div>
      {secondOpinionError}
    </div>
  ) : null;

  const cleanupAttention =
    cleanupAttentionMessage === null ? null : (
      <p role="alert" className={WARNING_CLASS}>
        <AlertTriangleIcon size={ATTENTION_ICON_SIZE} className="mt-0.5 shrink-0" />
        {cleanupAttentionMessage}
      </p>
    );

  const sandboxSummary = isSandboxUsageLoading ? (
    <p className={META_CLASS}>{SANDBOX_LOADING_LABEL}</p>
  ) : (
    <p className={META_CLASS}>
      {sandboxUsageLabel}
      {SANDBOX_SEPARATOR}
      {sandboxWorktreeLabel}
    </p>
  );

  // Disk housekeeping, folded away with the other accelerators. Its warning is not:
  // `cleanupAttention` stays outside, because a cleanup that left work behind is the
  // one thing here that always needs a human.
  const sandboxBlock = isSandboxSummaryVisible ? (
    <div className={ROW_CLASS}>
      <div className="min-w-0 flex-1">
        <p className={BLOCK_HEADING_CLASS}>{SANDBOX_HEADING}</p>
        {sandboxSummary}
      </div>
      <Button
        variant={BUTTON_VARIANT.SECONDARY}
        size={BUTTON_SIZE.SM}
        isDisabled={isCleanupDisabled}
        isLoading={isSandboxCleanupPending}
        onClick={onCleanupClick}
      >
        {CLEANUP_LABEL}
      </Button>
    </div>
  ) : null;

  const expandIcon = isExpanded ? (
    <ChevronDownIcon size={DISCLOSURE_ICON_SIZE} />
  ) : (
    <ChevronRightIcon size={DISCLOSURE_ICON_SIZE} />
  );

  return (
    <section aria-label={SECTION_LABEL}>
      <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.SM} className="flex flex-col gap-2">
        <div className={ROW_CLASS}>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            size={BUTTON_SIZE.SM}
            isDisabled={isStartDisabled}
            isLoading={isStartRunsPending}
            onClick={onStartClick}
          >
            {startLabel}
          </Button>
          {batchTierPicker}
          {/* Grouped so the pair holds the trailing edge whether or not the stop
              button is rendered. */}
          <div className={TRAILING_GROUP_CLASS}>
            {stopAllButton}
            <Button
              variant={BUTTON_VARIANT.GHOST}
              size={BUTTON_SIZE.SM}
              icon={expandIcon}
              isExpanded={isExpanded}
              onClick={onToggleExpandedClick}
            >
              {expandLabel}
            </Button>
          </div>
        </div>
        {poolSpendingNotice}
        {costUnknownNotice}
        {startError}
        <AutoModeToggle prRef={prRef} onEnabled={onAutoModeEnabled} />
        {activeRunList}
        {cancelError}
        {stopAllError}
        {bulkReview}
        {secondOpinionBatch}
        {sandboxBlock}
        {cleanupAttention}
      </Card>
    </section>
  );
}
