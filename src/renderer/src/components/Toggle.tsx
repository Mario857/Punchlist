import type { Ref } from 'react';
import { joinClassNames, mergeClassNames } from '@renderer/lib/classNames';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';

export const TOGGLE_SIZE = {
  SM: 'sm',
  MD: 'md',
} as const;

export type ToggleSize = (typeof TOGGLE_SIZE)[keyof typeof TOGGLE_SIZE];

export interface ToggleProps {
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
  /** Always required: it is the visible text and, when hidden, the accessible name. */
  label: string;
  isLabelHidden?: boolean;
  isDisabled?: boolean;
  size?: ToggleSize;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

const TOGGLE_TRACK_SIZE_CLASS: Record<ToggleSize, string> = {
  [TOGGLE_SIZE.SM]: 'h-4 w-7',
  [TOGGLE_SIZE.MD]: 'h-5 w-9',
};

const TOGGLE_KNOB_SIZE_CLASS: Record<ToggleSize, string> = {
  [TOGGLE_SIZE.SM]: 'size-3',
  [TOGGLE_SIZE.MD]: 'size-4',
};

/** Knob travel equals the track width minus the knob and both 2px insets. */
const TOGGLE_KNOB_CHECKED_CLASS: Record<ToggleSize, string> = {
  [TOGGLE_SIZE.SM]: 'translate-x-3',
  [TOGGLE_SIZE.MD]: 'translate-x-4',
};

const TOGGLE_LABEL_SIZE_CLASS: Record<ToggleSize, string> = {
  [TOGGLE_SIZE.SM]: 'text-xs',
  [TOGGLE_SIZE.MD]: 'text-sm',
};

/**
 * The whole row is the control, so the visible label is a click target too. `role`
 * is switch rather than checkbox because this is an immediate on/off setting, not a
 * value submitted with a form.
 */
export function Toggle({
  isChecked,
  onChange,
  label,
  isLabelHidden = false,
  isDisabled = false,
  size = TOGGLE_SIZE.MD,
  className,
  ref,
}: ToggleProps) {
  const onToggleClick = () => onChange(!isChecked);

  const trackStateClassName = isChecked
    ? 'border-accent bg-accent'
    : 'border-border bg-surface-raised';
  const knobStateClassName = isChecked
    ? joinClassNames(TOGGLE_KNOB_CHECKED_CLASS[size], 'bg-bg-0')
    : 'translate-x-0 bg-muted';

  const labelText = isLabelHidden ? null : (
    <span className={joinClassNames('text-ink', TOGGLE_LABEL_SIZE_CLASS[size])}>{label}</span>
  );

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-label={label}
      disabled={isDisabled}
      onClick={onToggleClick}
      className={mergeClassNames(
        'inline-flex items-center gap-2',
        'select-none',
        FOCUS_RING,
        DISABLED_STATE,
        className,
      )}
    >
      <span
        className={joinClassNames(
          'inline-flex shrink-0 items-center rounded-full border',
          TOGGLE_TRACK_SIZE_CLASS[size],
          trackStateClassName,
          INTERACTIVE_TRANSITION,
        )}
      >
        <span
          className={joinClassNames(
            'ml-0.5 inline-block rounded-full',
            TOGGLE_KNOB_SIZE_CLASS[size],
            knobStateClassName,
            'transition-transform motion-reduce:transition-none',
          )}
        />
      </span>
      {labelText}
    </button>
  );
}
