import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useBatchTierPicker } from './useBatchTierPicker';

export interface BatchTierPickerProps {
  selectedCommentIds: readonly string[];
}

const GROUP_LABEL = 'Model tier for the selected comments';
const GROUP_HEADING = 'Tier';

const GROUP_CLASS = 'flex items-center gap-1.5';
const GROUP_HEADING_CLASS = 'text-muted text-xs';
const OPTION_LIST_CLASS = 'flex items-center gap-1';
const OPTION_BASE_CLASS = 'h-6 rounded-full border px-2 text-xs font-medium whitespace-nowrap';
const OPTION_ACTIVE_CLASS = 'border-accent bg-accent/20 text-accent';
const OPTION_INACTIVE_CLASS = 'border-border text-muted hover:border-border-strong hover:text-ink';
const OPTION_DISABLED_CLASS = 'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * A radiogroup rather than a row of buttons: one tier applies to the whole selection,
 * so the options are mutually exclusive and `aria-checked` has to say which one holds.
 * `Button` cannot express that, and widening it for one caller would be worse.
 */
export function BatchTierPicker({ selectedCommentIds }: BatchTierPickerProps) {
  const { options, isDisabled } = useBatchTierPicker({ selectedCommentIds });

  const optionButtons = options.map((option) => (
    <button
      key={option.id}
      type="button"
      role="radio"
      aria-checked={option.isActive}
      disabled={isDisabled}
      onClick={option.onSelectClick}
      className={joinClassNames(
        OPTION_BASE_CLASS,
        option.isActive ? OPTION_ACTIVE_CLASS : OPTION_INACTIVE_CLASS,
        FOCUS_RING,
        INTERACTIVE_TRANSITION,
        OPTION_DISABLED_CLASS,
      )}
    >
      {option.label}
    </button>
  ));

  return (
    <div className={GROUP_CLASS}>
      <span className={GROUP_HEADING_CLASS}>{GROUP_HEADING}</span>
      <div role="radiogroup" aria-label={GROUP_LABEL} className={OPTION_LIST_CLASS}>
        {optionButtons}
      </div>
    </div>
  );
}
