import { useEffect, useRef, type RefObject } from 'react';
import {
  REVIEW_SHORTCUT_AVAILABILITY,
  REVIEW_SHORTCUT_BINDINGS,
  REVIEW_SHORTCUT_GROUP,
  type ReviewShortcutBinding,
  type ReviewShortcutGroup,
  type ReviewShortcutId,
} from '@renderer/hooks/useReviewShortcuts';
import { groupBy } from '@renderer/lib/collections';

export interface ShortcutHelpRow {
  id: ReviewShortcutId;
  keyLabel: string;
  description: string;
  /** Null once a binding is live. The map is documentation as much as a reminder. */
  pendingNote: string | null;
}

export interface ShortcutHelpGroup {
  name: ReviewShortcutGroup;
  rows: ShortcutHelpRow[];
}

interface UseShortcutHelpResult {
  dialogRef: RefObject<HTMLDialogElement | null>;
  groups: ShortcutHelpGroup[];
}

const PENDING_NOTE = 'Arrives with the review gate';

/** The order the map reads in, narrowest scope first. */
const GROUP_ORDER: readonly ReviewShortcutGroup[] = [
  REVIEW_SHORTCUT_GROUP.NAVIGATION,
  REVIEW_SHORTCUT_GROUP.DIFF,
  REVIEW_SHORTCUT_GROUP.REVIEW,
  REVIEW_SHORTCUT_GROUP.HELP,
];

const EMPTY_LENGTH = 0;

/**
 * Derived once at module scope: the binding table is a constant, so recomputing the
 * grouping per mount would be work with no input that can change.
 */
const SHORTCUT_HELP_GROUPS: ShortcutHelpGroup[] = buildShortcutHelpGroups();

export function useShortcutHelp(isOpen: boolean): UseShortcutHelpResult {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    // `showModal` is what buys the focus trap, the backdrop and Escape-to-close; the
    // `open` attribute alone renders a non-modal dialog with none of the three.
    if (isOpen && !dialog.open) dialog.showModal();
    // Guarded on `open` so closing in response to the dialog's own close event is not
    // a second `close()` call on an already-closed dialog.
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return { dialogRef, groups: SHORTCUT_HELP_GROUPS };
}

function buildShortcutHelpGroups(): ShortcutHelpGroup[] {
  const bindingsByGroup = groupBy(REVIEW_SHORTCUT_BINDINGS, (binding) => binding.group);

  const groups = GROUP_ORDER.map((name) => ({
    name,
    rows: (bindingsByGroup.get(name) ?? []).map(toRow),
  }));

  return groups.filter((group) => group.rows.length > EMPTY_LENGTH);
}

function toRow(binding: ReviewShortcutBinding): ShortcutHelpRow {
  const pendingNote =
    binding.availability === REVIEW_SHORTCUT_AVAILABILITY.REVIEW_GATE ? PENDING_NOTE : null;

  return {
    id: binding.id,
    keyLabel: binding.keyLabel,
    description: binding.description,
    pendingNote,
  };
}
