import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { useDebug } from '@renderer/screens/Debug/useDebug';

const SECTION_LABEL = 'Debug';
const RUNS_HEADING = 'Agent tokens by run';
const SUBPROCESS_HEADING = 'gh subprocess calls';
const EVENTS_HEADING = 'Background passes';
const POOL_LABEL = 'pool';
const EMPTY_RUNS_LABEL = 'No runs in this session yet.';
const EMPTY_COUNTERS_LABEL = 'Nothing counted yet.';

const HEADING_CLASS = 'text-ink text-lg font-semibold';
const EXPLANATION_CLASS = 'text-muted mt-1 max-w-3xl text-xs leading-relaxed';
const CARD_HEADING_CLASS = 'text-ink text-sm font-semibold';
const TABLE_CLASS = 'w-full text-left text-xs';
const HEAD_CELL_CLASS = 'text-muted py-1 pr-4 font-medium';
const CELL_CLASS = 'text-ink py-1 pr-4 tabular-nums';
const LABEL_CELL_CLASS = 'text-ink max-w-96 truncate py-1 pr-4';
const META_CLASS = 'text-muted text-xs';
const EMPTY_CLASS = 'text-muted text-xs leading-relaxed';

export function Debug() {
  const {
    heading,
    explanation,
    sinceLabel,
    runRows,
    totalsLabel,
    subprocessRows,
    eventRows,
    refreshLabel,
    isTelemetryLoading,
    onRefreshClick,
  } = useDebug();

  const runRowElements = runRows.map((row) => {
    const poolBadge = row.isPoolSpending ? (
      <Badge tone={BADGE_TONE.WARNING} isMuted>
        {POOL_LABEL}
      </Badge>
    ) : null;
    return (
      <tr key={row.runId}>
        <td className={LABEL_CELL_CLASS} title={row.label}>
          {row.label}
        </td>
        <td className={CELL_CLASS}>
          {row.model} {poolBadge}
        </td>
        <td className={CELL_CLASS}>{row.stateLabel}</td>
        <td className={CELL_CLASS}>{row.durationLabel}</td>
        <td className={CELL_CLASS}>{row.inputTokensLabel}</td>
        <td className={CELL_CLASS}>{row.outputTokensLabel}</td>
        <td className={CELL_CLASS}>{row.totalTokensLabel}</td>
      </tr>
    );
  });

  const runsBody =
    runRows.length === 0 ? (
      <p className={EMPTY_CLASS}>{EMPTY_RUNS_LABEL}</p>
    ) : (
      <>
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th className={HEAD_CELL_CLASS}>Run</th>
              <th className={HEAD_CELL_CLASS}>Model</th>
              <th className={HEAD_CELL_CLASS}>State</th>
              <th className={HEAD_CELL_CLASS}>Duration</th>
              <th className={HEAD_CELL_CLASS}>Tokens in</th>
              <th className={HEAD_CELL_CLASS}>Tokens out</th>
              <th className={HEAD_CELL_CLASS}>Total</th>
            </tr>
          </thead>
          <tbody>{runRowElements}</tbody>
        </table>
        <p className={META_CLASS}>{totalsLabel}</p>
      </>
    );

  const subprocessRowElements = subprocessRows.map((row) => (
    <tr key={row.command}>
      <td className={LABEL_CELL_CLASS} title={row.command}>
        {row.command}
      </td>
      <td className={CELL_CLASS}>{row.countLabel}</td>
      <td className={CELL_CLASS}>{row.averageDurationLabel}</td>
      <td className={CELL_CLASS}>{row.lastAtLabel}</td>
    </tr>
  ));

  const subprocessBody =
    subprocessRows.length === 0 ? (
      <p className={EMPTY_CLASS}>{EMPTY_COUNTERS_LABEL}</p>
    ) : (
      <table className={TABLE_CLASS}>
        <thead>
          <tr>
            <th className={HEAD_CELL_CLASS}>Command</th>
            <th className={HEAD_CELL_CLASS}>Calls</th>
            <th className={HEAD_CELL_CLASS}>Cost</th>
            <th className={HEAD_CELL_CLASS}>Last</th>
          </tr>
        </thead>
        <tbody>{subprocessRowElements}</tbody>
      </table>
    );

  const eventRowElements = eventRows.map((row) => (
    <tr key={row.name}>
      <td className={LABEL_CELL_CLASS}>{row.name}</td>
      <td className={CELL_CLASS}>{row.countLabel}</td>
      <td className={CELL_CLASS}>{row.lastAtLabel}</td>
    </tr>
  ));

  const eventsBody =
    eventRows.length === 0 ? (
      <p className={EMPTY_CLASS}>{EMPTY_COUNTERS_LABEL}</p>
    ) : (
      <table className={TABLE_CLASS}>
        <thead>
          <tr>
            <th className={HEAD_CELL_CLASS}>Pass</th>
            <th className={HEAD_CELL_CLASS}>Count</th>
            <th className={HEAD_CELL_CLASS}>Last</th>
          </tr>
        </thead>
        <tbody>{eventRowElements}</tbody>
      </table>
    );

  const since = sinceLabel === null ? null : <p className={META_CLASS}>{sinceLabel}</p>;

  return (
    <main aria-label={SECTION_LABEL} className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="flex flex-col gap-4">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className={HEADING_CLASS}>{heading}</h1>
            <p className={EXPLANATION_CLASS}>{explanation}</p>
            {since}
          </div>
          <Button
            variant={BUTTON_VARIANT.SECONDARY}
            size={BUTTON_SIZE.SM}
            isLoading={isTelemetryLoading}
            onClick={onRefreshClick}
          >
            {refreshLabel}
          </Button>
        </header>
        <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className="flex flex-col gap-2">
          <h2 className={CARD_HEADING_CLASS}>{RUNS_HEADING}</h2>
          {runsBody}
        </Card>
        <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className="flex flex-col gap-2">
          <h2 className={CARD_HEADING_CLASS}>{SUBPROCESS_HEADING}</h2>
          {subprocessBody}
        </Card>
        <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className="flex flex-col gap-2">
          <h2 className={CARD_HEADING_CLASS}>{EVENTS_HEADING}</h2>
          {eventsBody}
        </Card>
      </div>
    </main>
  );
}
