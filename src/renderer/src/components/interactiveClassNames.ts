/**
 * Every interactive primitive focuses and animates identically, so the ring and the
 * transition live here rather than being retyped per component.
 *
 * Deliberately no `outline-none`: in Tailwind v4 it sets `--tw-outline-style: none`,
 * which `outline-2` then reads back at focus time and the ring never renders. The
 * browser draws no outline outside :focus-visible anyway, so overriding width, offset
 * and colour is all that is needed — and it can never suppress the ring entirely.
 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const INTERACTIVE_TRANSITION = 'transition-colors motion-reduce:transition-none';

export const DISABLED_STATE = 'disabled:cursor-not-allowed disabled:opacity-50';
