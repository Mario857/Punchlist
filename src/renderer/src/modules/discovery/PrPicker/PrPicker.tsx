import type { PrRef } from '@shared/discovery';
import { Button, BUTTON_SIZE, BUTTON_TYPE, BUTTON_VARIANT } from '@renderer/components/Button';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { PrPickerAlert } from '@renderer/modules/discovery/PrPicker/components/PrPickerAlert';
import { PrPickerRow } from '@renderer/modules/discovery/PrPicker/components/PrPickerRow';
import { usePrPicker } from '@renderer/modules/discovery/PrPicker/usePrPicker';

export interface PrPickerProps {
  selectedPr: PrRef | null;
  onSelectPr: (ref: PrRef) => void;
}

const PR_PICKER_HEADING_ID = 'pr-picker-heading';
const PR_URL_INPUT_ID = 'pr-picker-url';
const PR_URL_PLACEHOLDER = 'https://github.com/owner/repo/pull/123';
const LOADING_LABEL = 'Searching your open pull requests';

export function PrPicker({ selectedPr, onSelectPr }: PrPickerProps) {
  const {
    rows,
    hasPrRows,
    isPrListEmpty,
    countLabel,
    isDiscoveredPrsLoading,
    refreshStatusLabel,
    isRefreshingDiscoveredPrs,
    listAlert,
    prUrlValue,
    prUrlAlert,
    resolvedPrRow,
    isResolvePrUrlPending,
    isPrUrlSubmitDisabled,
    canClearPrUrl,
    onRefreshClick,
    onPrUrlChange,
    onPrUrlSubmit,
    onClearPrUrlClick,
  } = usePrPicker(selectedPr, onSelectPr);

  const rowElements = rows.map((row) => <PrPickerRow key={row.prKey} item={row} />);

  const listContent = (() => {
    if (isDiscoveredPrsLoading) {
      return (
        <div className="text-muted flex items-center gap-2 p-3 text-sm">
          <Spinner size={SPINNER_SIZE.SM} label={LOADING_LABEL} />
          <span>{LOADING_LABEL}…</span>
        </div>
      );
    }
    if (hasPrRows) {
      return (
        <ul role="list" className="flex flex-col gap-1.5">
          {rowElements}
        </ul>
      );
    }
    if (isPrListEmpty) {
      return (
        <p className="text-muted p-3 text-sm">
          No open pull requests were found for your GitHub account.
        </p>
      );
    }
    return null;
  })();

  const listAlertBlock =
    listAlert === null ? null : (
      <PrPickerAlert message={listAlert.message} remediation={listAlert.remediation} />
    );

  const prUrlAlertBlock =
    prUrlAlert === null ? null : (
      <PrPickerAlert message={prUrlAlert.message} remediation={prUrlAlert.remediation} />
    );

  const clearButton = canClearPrUrl ? (
    <Button
      variant={BUTTON_VARIANT.GHOST}
      size={BUTTON_SIZE.MD}
      onClick={onClearPrUrlClick}
      title="Clear the pasted URL and its result"
    >
      Clear
    </Button>
  ) : null;

  const resolvedPrSection =
    resolvedPrRow === null ? null : (
      <div className="flex flex-col gap-1.5">
        <p className="text-muted text-xs font-medium">Resolved from URL</p>
        <ul role="list">
          <PrPickerRow item={resolvedPrRow} />
        </ul>
      </div>
    );

  return (
    <section
      aria-labelledby={PR_PICKER_HEADING_ID}
      className="flex h-full min-h-0 flex-col gap-3 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id={PR_PICKER_HEADING_ID} className="text-ink text-sm font-semibold">
            Your open PRs
          </h2>
          <span className="text-muted/80 text-xs tabular-nums">{countLabel}</span>
        </div>
        <IconButton
          label="Refresh pull requests"
          icon={<RefreshIcon />}
          size={ICON_BUTTON_SIZE.SM}
          isLoading={isRefreshingDiscoveredPrs}
          onClick={onRefreshClick}
        />
      </header>

      <p aria-live="polite" className="text-muted/80 h-4 text-xs">
        {refreshStatusLabel}
      </p>

      {listAlertBlock}

      <div className="min-h-0 flex-1 overflow-y-auto">{listContent}</div>

      <form onSubmit={onPrUrlSubmit} className="border-border flex flex-col gap-2 border-t pt-3">
        <label htmlFor={PR_URL_INPUT_ID} className="text-muted text-xs font-medium">
          Pull request URL
        </label>
        <div className="flex items-center gap-2">
          <input
            id={PR_URL_INPUT_ID}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={PR_URL_PLACEHOLDER}
            value={prUrlValue}
            onChange={onPrUrlChange}
            className={joinClassNames(
              'h-9 min-w-0 flex-1 rounded-md border px-2.5',
              'text-sm',
              'border-border bg-surface-raised text-ink placeholder:text-muted/60',
              FOCUS_RING,
              INTERACTIVE_TRANSITION,
            )}
          />
          <Button
            type={BUTTON_TYPE.SUBMIT}
            size={BUTTON_SIZE.MD}
            isDisabled={isPrUrlSubmitDisabled}
            isLoading={isResolvePrUrlPending}
          >
            Find PR
          </Button>
          {clearButton}
        </div>
        <p className="text-muted/70 text-xs leading-snug">
          The escape hatch for a pull request you did not author, which the search above never
          returns.
        </p>
        {prUrlAlertBlock}
        {resolvedPrSection}
      </form>
    </section>
  );
}
