import type { PrRef } from '@shared/discovery';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Toggle, TOGGLE_SIZE } from '@renderer/components/Toggle';
import { useAutoModeToggle } from '@renderer/modules/runs/AutoModeToggle/useAutoModeToggle';

export interface AutoModeToggleProps {
  /** Scopes the deferred-decision count to the PR whose runs are on screen. */
  prRef: PrRef | null;
  /** Called when auto mode is switched on, so the host can pre-select the recommended set. */
  onEnabled: () => void;
}

const SECTION_LABEL = 'Auto mode';
const TOGGLE_LABEL = 'Auto mode';

/**
 * The boundary is the feature. Hover detail rather than a paragraph under the switch:
 * what it decides, and the three things it never touches.
 */
const BOUNDARY_NOTE =
  'Picks the recommended comments, takes the heuristic tier, and answers blocking questions with the agent’s top option — it never approves a diff, never lands anything, and never uses a paid model.';

const COLUMN_CLASS = 'flex flex-col gap-1.5';
const ROW_CLASS = 'flex flex-wrap items-center gap-2';
/** Deferred decisions are a thing to read, not a fault, so this reads as accent not alarm. */
const DEFERRED_CLASS = 'text-accent text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

export function AutoModeToggle({ prRef, onEnabled }: AutoModeToggleProps) {
  const {
    isEnabled,
    isToggleDisabled,
    onStateLabel,
    deferredDecisionsLabel,
    errorMessage,
    onEnabledChange,
  } = useAutoModeToggle({ prRef, onEnabled });

  const onStateBadge =
    onStateLabel === null ? null : <Badge tone={BADGE_TONE.ACCENT}>{onStateLabel}</Badge>;

  const deferredDecisions =
    deferredDecisionsLabel === null ? null : (
      <p role="status" className={DEFERRED_CLASS}>
        {deferredDecisionsLabel}
      </p>
    );

  const error =
    errorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {errorMessage}
      </p>
    );

  return (
    <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
      <div className={ROW_CLASS}>
        <Toggle
          isChecked={isEnabled}
          onChange={onEnabledChange}
          label={TOGGLE_LABEL}
          isDisabled={isToggleDisabled}
          title={BOUNDARY_NOTE}
          size={TOGGLE_SIZE.SM}
        />
        {onStateBadge}
      </div>
      {deferredDecisions}
      {error}
    </section>
  );
}
