import type { ReactNode } from 'react';
import { BUTTON_VARIANT } from '@renderer/components/Button';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { PanelLeftIcon } from '@renderer/components/icons/PanelLeftIcon';
import { PanelRightIcon } from '@renderer/components/icons/PanelRightIcon';
import type { PaneKey, PaneToggleItem } from '@renderer/screens/Workspace/useWorkspace';

interface Props {
  items: PaneToggleItem[];
}

const GROUP_LABEL = 'Visible panes';
const HIDDEN_LABEL_PREFIX = 'Show the ';
const VISIBLE_LABEL_PREFIX = 'Hide the ';
const LABEL_SUFFIX = ' pane';
const PANE_ICON_SIZE = 14;

/** The glyph carries the meaning the text used to: which side of the layout it flips. */
const PANE_ICON: Record<PaneKey, ReactNode> = {
  commentList: <PanelLeftIcon size={PANE_ICON_SIZE} />,
  reviewPane: <PanelRightIcon size={PANE_ICON_SIZE} />,
};

/**
 * Which of the panes are on screen. Pressed rather than checked: these turn parts of
 * the workspace on and off rather than selecting among them, so more than one is
 * meaningfully on at once. Icon-only — the glyphs say which side they flip, and the
 * accessible name still says it in words.
 */
export function PaneToggles({ items }: Props) {
  const buttons = items.map((item) => {
    const prefix = item.isVisible ? VISIBLE_LABEL_PREFIX : HIDDEN_LABEL_PREFIX;
    const label = `${prefix}${item.label}${LABEL_SUFFIX}`;

    return (
      <IconButton
        key={item.key}
        label={label}
        icon={PANE_ICON[item.key]}
        variant={item.isVisible ? BUTTON_VARIANT.SECONDARY : BUTTON_VARIANT.GHOST}
        size={ICON_BUTTON_SIZE.SM}
        isPressed={item.isVisible}
        isDisabled={item.isDisabled}
        onClick={item.onToggle}
      />
    );
  });

  return (
    <div role="group" aria-label={GROUP_LABEL} className="flex items-center gap-1">
      {buttons}
    </div>
  );
}
