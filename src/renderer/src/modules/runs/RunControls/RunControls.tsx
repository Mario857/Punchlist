import type { PrRef } from '@shared/discovery';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { StateBadge } from '@renderer/components/StateBadge';
import { Toggle, TOGGLE_SIZE } from '@renderer/components/Toggle';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { XIcon } from '@renderer/components/icons/XIcon';
import { BatchTierPicker } from '@renderer/modules/runs/RunControls/components/BatchTierPicker/BatchTierPicker';
import { useRunControls } from '@renderer/modules/runs/RunControls/useRunControls';

export interface RunControlsProps {
  /** Null before a PR is chosen: a run needs a local clone to build its worktree from. */
  prRef: PrRef | null;
}

const SECTION_LABEL = 'Run controls';
const SANDBOX_HEADING = 'Sandbox';
const CLEANUP_LABEL = 'Clean up finished';
const CANCEL_LABEL_PREFIX = 'Cancel ';
const SANDBOX_LOADING_LABEL = 'Measuring sandbox…';
const SANDBOX_SEPARATOR = ' · ';
const POOL_SPENDING_ACKNOWLEDGE_LABEL = 'Spend the included pool for this batch';

const CANCEL_ICON_SIZE = 11;
const ATTENTION_ICON_SIZE = 12;

const ROW_CLASS = 'flex items-center gap-2';
const META_CLASS = 'text-muted text-xs';
/** Pushed to the trailing edge of its row, matching the filter bar's triage counter. */
const ACTIVE_RUNS_LABEL_CLASS = 'text-muted ml-auto text-xs';
const ALERT_CLASS = 'text-danger text-xs leading-relaxed';
const WARNING_CLASS = 'text-warning flex items-start gap-1.5 text-xs leading-relaxed';
const ACTIVE_RUN_ROW_CLASS = 'bg-surface-raised flex items-center gap-2 rounded-md px-1.5 py-1';
const ACTIVE_RUN_LABEL_CLASS = 'text-ink min-w-0 flex-1 truncate text-xs';

export function RunControls({ prRef }: RunControlsProps) {
  const {
    startLabel,
    isStartDisabled,
    isStartRunsPending,
    startErrorMessage,
    selectedCommentIds,
    hasSelection,
    poolSpendingMessage,
    isPoolSpendingAcknowledged,
    onPoolSpendingAcknowledgedChange,
    costUnknownMessage,
    activeRunItems,
    hasActiveRuns,
    activeRunsLabel,
    isCancelRunPending,
    cancelErrorMessage,
    stopAllLabel,
    isStopAllRunsPending,
    stopAllErrorMessage,
    onStopAllClick,
    sandboxUsageLabel,
    sandboxWorktreeLabel,
    isSandboxUsageLoading,
    isCleanupDisabled,
    isSandboxCleanupPending,
    cleanupAttentionMessage,
    onStartClick,
    onCleanupClick,
  } = useRunControls({ prRef });

  const activeRunRows = activeRunItems.map((item) => (
    <li key={item.runId} className={ACTIVE_RUN_ROW_CLASS}>
      <StateBadge state={item.state} />
      <span className={ACTIVE_RUN_LABEL_CLASS} title={item.label}>
        {item.label}
      </span>
      <IconButton
        label={`${CANCEL_LABEL_PREFIX}${item.label}`}
        icon={<XIcon size={CANCEL_ICON_SIZE} />}
        size={ICON_BUTTON_SIZE.SM}
        isDisabled={isCancelRunPending}
        onClick={item.onCancelClick}
      />
    </li>
  ));

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

  const poolSpendingNotice =
    poolSpendingMessage === null ? null : (
      <div className="flex flex-col gap-1.5">
        <p role="alert" className={WARNING_CLASS}>
          <AlertTriangleIcon size={ATTENTION_ICON_SIZE} className="mt-0.5 shrink-0" />
          {poolSpendingMessage}
        </p>
        <Toggle
          isChecked={isPoolSpendingAcknowledged}
          onChange={onPoolSpendingAcknowledgedChange}
          label={POOL_SPENDING_ACKNOWLEDGE_LABEL}
          size={TOGGLE_SIZE.SM}
        />
      </div>
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
          <span role="status" className={ACTIVE_RUNS_LABEL_CLASS}>
            {activeRunsLabel}
          </span>
          {stopAllButton}
        </div>
        {poolSpendingNotice}
        {costUnknownNotice}
        {startError}
        {activeRunList}
        {cancelError}
        {stopAllError}
        <div className={ROW_CLASS}>
          <div className="min-w-0 flex-1">
            <p className="text-ink text-xs font-medium">{SANDBOX_HEADING}</p>
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
        {cleanupAttention}
      </Card>
    </section>
  );
}
