/**
 * A session-scoped view of where the app spends: subprocess calls, background
 * passes, and agent tokens. In-memory on purpose — this is a lens for optimising the
 * app, not a log worth persisting — so every counter resets with the process.
 */
export interface SubprocessCallStat {
  /** The first two arguments — `api graphql`, `search prs` — never payloads. */
  command: string;
  count: number;
  totalDurationMs: number;
  lastAt: string;
}

export interface BackgroundEventStat {
  name: string;
  count: number;
  lastAt: string;
}

export interface DebugTelemetry {
  /** When this process started counting, so rates can be judged against a window. */
  sinceAt: string;
  subprocessCalls: SubprocessCallStat[];
  backgroundEvents: BackgroundEventStat[];
}
