/**
 * Exhausts a discriminated union in the default branch of a `switch`, so adding a
 * `RunState` or `PrComment['kind']` variant becomes a compile error rather than a
 * silent fallthrough.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled union member: ${String(value)}`);
}
