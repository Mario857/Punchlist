import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import type { PaneToggleItem } from '@renderer/screens/Workspace/useWorkspace';

interface Props {
  items: PaneToggleItem[];
}

const GROUP_LABEL = 'Visible panes';
const HIDDEN_TITLE_PREFIX = 'Show the ';
const VISIBLE_TITLE_PREFIX = 'Hide the ';
const TITLE_SUFFIX = ' pane';
const LAST_PANE_TITLE = 'The last visible pane cannot be hidden';

/**
 * Which of the three panes are on screen. Pressed rather than checked: these turn parts
 * of the workspace on and off rather than selecting among them, so more than one is
 * meaningfully on at once.
 */
export function PaneToggles({ items }: Props) {
  const buttons = items.map((item) => {
    const title = (() => {
      if (item.isDisabled) return LAST_PANE_TITLE;
      const prefix = item.isVisible ? VISIBLE_TITLE_PREFIX : HIDDEN_TITLE_PREFIX;
      return `${prefix}${item.label}${TITLE_SUFFIX}`;
    })();

    return (
      <Button
        key={item.key}
        variant={item.isVisible ? BUTTON_VARIANT.SECONDARY : BUTTON_VARIANT.GHOST}
        size={BUTTON_SIZE.SM}
        isPressed={item.isVisible}
        isDisabled={item.isDisabled}
        title={title}
        onClick={item.onToggle}
      >
        {item.label}
      </Button>
    );
  });

  return (
    <div role="group" aria-label={GROUP_LABEL} className="flex items-center gap-1">
      {buttons}
    </div>
  );
}
