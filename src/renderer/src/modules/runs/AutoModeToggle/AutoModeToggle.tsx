import type { PrRef } from '@shared/discovery';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Toggle, TOGGLE_SIZE } from '@renderer/components/Toggle';
import { useAutoModeToggle } from '@renderer/modules/runs/AutoModeToggle/useAutoModeToggle';

export interface AutoModeToggleProps {
  /** Scopes the deferred-decision count to the PR whose runs are on screen. */
  prRef: PrRef | null;
  /** Called when auto mode is switched on, so the host can pre-select the recommended set. */
  onEnabled: () => void;
  /**
   * The boundary copy is worth reading once and then never again, so the host folds it
   * away with the rest of the explanatory prose. The switch itself always shows.
   */
  isExplanationVisible: boolean;
}

const SECTION_LABEL = 'Auto mode';
const TOGGLE_LABEL = 'Auto mode';

/**
 * The boundary is the feature, so it is one line of copy sitting under the switch
 * rather than a paragraph nobody reads: what it decides, and the three things it never
 * touches.
 */
const BOUNDARY_NOTE =
  'Picks the recommended comments, takes the heuristic tier, and answers blocking questions with the agent’s top option — it never approves a diff, never lands anything, and never uses a paid model.';

const COLUMN_CLASS = 'flex flex-col gap-1.5';
const ROW_CLASS = 'flex flex-wrap items-center gap-2';
const NOTE_CLASS = 'text-muted text-xs leading-relaxed';
/** Deferred decisions are a thing to read, not a fault, so this reads as accent not alarm. */
const DEFERRED_CLASS = 'text-accent text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

export function AutoModeToggle({ prRef, onEnabled, isExplanationVisible }: AutoModeToggleProps) {
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

  const boundaryNote = isExplanationVisible ? <p className={NOTE_CLASS}>{BOUNDARY_NOTE}</p> : null;

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
          size={TOGGLE_SIZE.SM}
        />
        {onStateBadge}
      </div>
      {boundaryNote}
      {deferredDecisions}
      {error}
    </section>
  );
}
