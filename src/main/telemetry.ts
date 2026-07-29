import type { BackgroundEventStat, DebugTelemetry, SubprocessCallStat } from '@shared/debug';

/**
 * Session counters for the Debug screen. In-memory and append-cheap: recording must
 * cost nothing on the hot paths it observes, and losing the numbers on restart is
 * fine because the point is watching the app run, not archiving it.
 */
const startedAt = new Date().toISOString();
const subprocessCalls = new Map<string, SubprocessCallStat>();
const backgroundEvents = new Map<string, BackgroundEventStat>();

export function recordSubprocessCall(command: string, durationMs: number): void {
  const existing = subprocessCalls.get(command);
  if (existing === undefined) {
    subprocessCalls.set(command, {
      command,
      count: 1,
      totalDurationMs: durationMs,
      lastAt: new Date().toISOString(),
    });
    return;
  }
  existing.count += 1;
  existing.totalDurationMs += durationMs;
  existing.lastAt = new Date().toISOString();
}

export function recordBackgroundEvent(name: string): void {
  const existing = backgroundEvents.get(name);
  if (existing === undefined) {
    backgroundEvents.set(name, { name, count: 1, lastAt: new Date().toISOString() });
    return;
  }
  existing.count += 1;
  existing.lastAt = new Date().toISOString();
}

export function snapshotTelemetry(): DebugTelemetry {
  return {
    sinceAt: startedAt,
    subprocessCalls: [...subprocessCalls.values()].sort((left, right) => right.count - left.count),
    backgroundEvents: [...backgroundEvents.values()].sort(
      (left, right) => right.count - left.count,
    ),
  };
}
