import { Badge } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { isDefined } from '@renderer/lib/guards';
import { joinClassNames } from '@renderer/lib/classNames';
import { TierModelRow } from '@renderer/modules/settings/TierModelMapping/components/TierModelRow';
import { useTierModelMapping } from '@renderer/modules/settings/TierModelMapping/useTierModelMapping';

const CATALOG_LOADING_LABEL = 'Reading the model catalog';
const CATALOG_LOADING_MESSAGE = 'Reading this account’s model catalog…';
const REFRESH_LABEL = 'Refresh catalog';

const CURSOR_KEY_NOTICE_CLASS = joinClassNames(
  'mt-4 rounded-md border p-3',
  'border-warning/40 bg-warning/10',
);

export function TierModelMapping() {
  const {
    tierRows,
    summaryBadgeLabel,
    summaryBadgeTone,
    isSummaryBadgeMuted,
    isModelRoutingLoading,
    isCursorKeyMissing,
    cursorKeyMissingTitle,
    cursorKeyMissingMessage,
    modelRoutingErrorMessage,
    modelRoutingRemediation,
    settingsErrorMessage,
    isRefreshDisabled,
    onRefreshCatalogClick,
  } = useTierModelMapping();

  const rows = tierRows.map((row) => <TierModelRow key={row.tier} row={row} />);

  const settingsErrorLine = isDefined(settingsErrorMessage) ? (
    <p role="alert" className="text-danger mt-2 text-xs">
      {settingsErrorMessage}
    </p>
  ) : null;

  const remediationLine = isDefined(modelRoutingRemediation) ? (
    <code className="text-ink border-border bg-bg-0 mt-2 block rounded-md border p-2 font-mono text-xs">
      {modelRoutingRemediation}
    </code>
  ) : null;

  const body = (() => {
    if (isModelRoutingLoading) {
      return (
        <p className="text-muted mt-4 flex items-center gap-2 text-sm">
          <Spinner size={SPINNER_SIZE.SM} label={CATALOG_LOADING_LABEL} />
          {CATALOG_LOADING_MESSAGE}
        </p>
      );
    }

    if (isCursorKeyMissing) {
      return (
        <div role="status" className={CURSOR_KEY_NOTICE_CLASS}>
          <p className="text-warning flex items-center gap-2 text-sm font-medium">
            <AlertTriangleIcon className="shrink-0" />
            {cursorKeyMissingTitle}
          </p>
          <p className="text-muted mt-1 text-xs leading-relaxed">{cursorKeyMissingMessage}</p>
        </div>
      );
    }

    if (isDefined(modelRoutingErrorMessage)) {
      return (
        <div role="alert" className="mt-4">
          <p className="text-danger text-sm">{modelRoutingErrorMessage}</p>
          {remediationLine}
        </div>
      );
    }

    return <ul className="mt-4 flex flex-col gap-3">{rows}</ul>;
  })();

  return (
    <Card padding={CARD_PADDING.LG}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-ink text-sm font-semibold">Tier routing</h2>
          <p className="text-muted mt-1 text-xs leading-relaxed">
            Each tier the router assigns a comment resolves to a model at run time, from this
            account’s live catalog rather than a list baked into the app. Every tier starts in the
            unlimited lane — complex included — so a run costs nothing by default and anything that
            draws down your included pool is a choice you made here.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={summaryBadgeTone} isMuted={isSummaryBadgeMuted}>
            {summaryBadgeLabel}
          </Badge>
          <Button
            size={BUTTON_SIZE.SM}
            variant={BUTTON_VARIANT.SECONDARY}
            icon={<RefreshIcon />}
            isDisabled={isRefreshDisabled}
            onClick={onRefreshCatalogClick}
          >
            {REFRESH_LABEL}
          </Button>
        </div>
      </header>
      {settingsErrorLine}
      {body}
    </Card>
  );
}
