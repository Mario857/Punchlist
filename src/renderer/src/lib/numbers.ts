const DIVIDE_BY_ZERO_RESULT = 0;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Division that yields a renderable number instead of `Infinity` or `NaN`. */
export function safeDiv(numerator: number, denominator: number): number {
  if (denominator === 0) return DIVIDE_BY_ZERO_RESULT;
  return numerator / denominator;
}
