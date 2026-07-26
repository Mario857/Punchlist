import { twJoin, twMerge, type ClassNameValue } from 'tailwind-merge';

/**
 * The default helper. `twJoin` skips tailwind-merge's conflict-resolution pass,
 * which is wasted work whenever no consumer can override the classes.
 */
export function joinClassNames(...values: ClassNameValue[]): string {
  return twJoin(...values);
}

/**
 * For components that expose a `className` prop. Pass that prop last so the
 * consumer's classes win the conflict resolution.
 */
export function mergeClassNames(...values: ClassNameValue[]): string {
  return twMerge(...values);
}
