import { useQuery } from '@tanstack/react-query';
import type { RunRecord } from '@shared/runs';
import { formatDuration } from '@renderer/lib/format';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';
import { useRunStore } from '@renderer/stores/runStore';

export interface DebugRunRow {
  runId: string;
  label: string;
  model: string;
  stateLabel: string;
  isPoolSpending: boolean;
  durationLabel: string;
  inputTokensLabel: string;
  outputTokensLabel: string;
  totalTokensLabel: string;
}

export interface DebugSubprocessRow {
  command: string;
  countLabel: string;
  averageDurationLabel: string;
  lastAtLabel: string;
}

export interface DebugEventRow {
  name: string;
  countLabel: string;
  lastAtLabel: string;
}

interface UseDebugResult {
  heading: string;
  explanation: string;
  sinceLabel: string | null;
  runRows: DebugRunRow[];
  totalsLabel: string;
  subprocessRows: DebugSubprocessRow[];
  eventRows: DebugEventRow[];
  refreshLabel: string;
  isTelemetryLoading: boolean;
  onRefreshClick: () => void;
}

const HEADING = 'Debug';
const EXPLANATION =
  'Where this session is spending: agent tokens per run, every gh call with its cost in time, and each background pass. Counters reset with the app, and this screen only reads them — refreshing is the one request it makes.';
const REFRESH_LABEL = 'Refresh counters';
const SINCE_PREFIX = 'Counting since ';
const NO_VALUE = '--';
const UNKNOWN_MODEL_LABEL = 'unresolved';
const TOTAL_PREFIX = 'Total across runs: ';
const TOTAL_INPUT_INFIX = ' in / ';
const TOTAL_OUTPUT_SUFFIX = ' out';
const MS_SUFFIX = 'ms avg';

function formatTokens(count: number | null): string {
  if (count === null) return NO_VALUE;
  return count.toLocaleString();
}

function toRunRow(run: RunRecord): DebugRunRow {
  return {
    runId: run.id,
    label: run.summary?.subject ?? run.branchName,
    model: run.model ?? UNKNOWN_MODEL_LABEL,
    stateLabel: run.state,
    isPoolSpending: run.isPoolSpending,
    durationLabel: formatDuration(run.durationMs),
    inputTokensLabel: formatTokens(run.tokenUsage?.inputTokens ?? null),
    outputTokensLabel: formatTokens(run.tokenUsage?.outputTokens ?? null),
    totalTokensLabel: formatTokens(run.tokenUsage?.totalTokens ?? null),
  };
}

/**
 * The optimisation lens: everything the app spends, in one place. Run tokens come
 * straight from the run store the event stream already fills, so the only IPC this
 * screen performs is the counter snapshot — a debug surface that polled would be
 * spending the thing it exists to watch.
 */
export function useDebug(): UseDebugResult {
  const runsById = useRunStore((state) => state.runsById);

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.debugTelemetry(),
    queryFn: async () => unwrapIpcResult(await requireBridge().debug.telemetry()),
  });

  const runs = Object.values(runsById).sort(
    (left, right) => (right.tokenUsage?.totalTokens ?? 0) - (left.tokenUsage?.totalTokens ?? 0),
  );

  const totalInput = runs.reduce((sum, run) => sum + (run.tokenUsage?.inputTokens ?? 0), 0);
  const totalOutput = runs.reduce((sum, run) => sum + (run.tokenUsage?.outputTokens ?? 0), 0);

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    sinceLabel: data === undefined ? null : `${SINCE_PREFIX}${data.sinceAt}`,
    runRows: runs.map(toRunRow),
    totalsLabel: `${TOTAL_PREFIX}${formatTokens(totalInput)}${TOTAL_INPUT_INFIX}${formatTokens(totalOutput)}${TOTAL_OUTPUT_SUFFIX}`,
    subprocessRows: (data?.subprocessCalls ?? []).map((call) => ({
      command: call.command,
      countLabel: call.count.toLocaleString(),
      averageDurationLabel: `${Math.round(call.totalDurationMs / call.count)}${MS_SUFFIX}`,
      lastAtLabel: call.lastAt,
    })),
    eventRows: (data?.backgroundEvents ?? []).map((event) => ({
      name: event.name,
      countLabel: event.count.toLocaleString(),
      lastAtLabel: event.lastAt,
    })),
    refreshLabel: REFRESH_LABEL,
    isTelemetryLoading: isLoading,
    onRefreshClick: () => {
      void refetch();
    },
  };
}
