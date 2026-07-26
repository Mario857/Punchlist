import { useCallback, useEffect, useMemo, useState } from 'react';

export const REVIEW_SHORTCUT_ID = {
  NEXT_ROW: 'nextRow',
  PREVIOUS_ROW: 'previousRow',
  COLLAPSE_ROW: 'collapseRow',
  EXPAND_ROW: 'expandRow',
  FOCUS_DIFF_PANE: 'focusDiffPane',
  PREVIOUS_HUNK: 'previousHunk',
  NEXT_HUNK: 'nextHunk',
  INLINE_PROMPT: 'inlinePrompt',
  DISMISS_RUN: 'dismissRun',
  APPROVE: 'approve',
  REJECT: 'reject',
  SHOW_HELP: 'showHelp',
} as const;

export type ReviewShortcutId = (typeof REVIEW_SHORTCUT_ID)[keyof typeof REVIEW_SHORTCUT_ID];

/** Section headings in the help map; the map is grouped in this declaration order. */
export const REVIEW_SHORTCUT_GROUP = {
  NAVIGATION: 'Navigation',
  DIFF: 'Diff',
  REVIEW: 'Review',
  HELP: 'Help',
} as const;

export type ReviewShortcutGroup =
  (typeof REVIEW_SHORTCUT_GROUP)[keyof typeof REVIEW_SHORTCUT_GROUP];

export const REVIEW_SHORTCUT_AVAILABILITY = {
  AVAILABLE: 'available',
  /** Documented in the map, deliberately unbound until the review gate lands. */
  REVIEW_GATE: 'reviewGate',
} as const;

export type ReviewShortcutAvailability =
  (typeof REVIEW_SHORTCUT_AVAILABILITY)[keyof typeof REVIEW_SHORTCUT_AVAILABILITY];

export interface ReviewShortcutDescription {
  id: ReviewShortcutId;
  group: ReviewShortcutGroup;
  /** What the help map prints — the glyph, not the `KeyboardEvent.key`. */
  keyLabel: string;
  description: string;
}

export interface AvailableReviewShortcutBinding extends ReviewShortcutDescription {
  availability: typeof REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE;
  /** Matched against `KeyboardEvent.key`, so `?` already carries its shift. */
  eventKey: string;
  hasCommandModifier: boolean;
}

export interface PendingReviewShortcutBinding extends ReviewShortcutDescription {
  availability: typeof REVIEW_SHORTCUT_AVAILABILITY.REVIEW_GATE;
}

/**
 * A pending binding has no key at all rather than a key with no handler, so an
 * unimplemented shortcut cannot swallow a keypress on its way to a real one.
 */
export type ReviewShortcutBinding = AvailableReviewShortcutBinding | PendingReviewShortcutBinding;

const NO_COMMAND_MODIFIER = false;
const WITH_COMMAND_MODIFIER = true;

/**
 * The single source of truth for the review keyboard. `useReviewShortcuts` dispatches
 * from this table and `ShortcutHelp` renders from it, so the documented map cannot
 * drift from what the keyboard actually does.
 */
export const REVIEW_SHORTCUT_BINDINGS: readonly ReviewShortcutBinding[] = [
  {
    id: REVIEW_SHORTCUT_ID.NEXT_ROW,
    group: REVIEW_SHORTCUT_GROUP.NAVIGATION,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: 'j',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: 'j',
    description: 'Move down the visible tree rows, skipping collapsed subtrees',
  },
  {
    id: REVIEW_SHORTCUT_ID.PREVIOUS_ROW,
    group: REVIEW_SHORTCUT_GROUP.NAVIGATION,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: 'k',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: 'k',
    description: 'Move up the visible tree rows, skipping collapsed subtrees',
  },
  {
    id: REVIEW_SHORTCUT_ID.COLLAPSE_ROW,
    group: REVIEW_SHORTCUT_GROUP.NAVIGATION,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: 'ArrowLeft',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: '←',
    description: 'Collapse the focused row, or move to its parent',
  },
  {
    id: REVIEW_SHORTCUT_ID.EXPAND_ROW,
    group: REVIEW_SHORTCUT_GROUP.NAVIGATION,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: 'ArrowRight',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: '→',
    description: 'Expand the focused row, or move to its first child',
  },
  {
    id: REVIEW_SHORTCUT_ID.FOCUS_DIFF_PANE,
    group: REVIEW_SHORTCUT_GROUP.DIFF,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: 'e',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: 'e',
    description: 'Focus the diff pane',
  },
  {
    id: REVIEW_SHORTCUT_ID.PREVIOUS_HUNK,
    group: REVIEW_SHORTCUT_GROUP.DIFF,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: '[',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: '[',
    description: 'Jump to the previous changed hunk',
  },
  {
    id: REVIEW_SHORTCUT_ID.NEXT_HUNK,
    group: REVIEW_SHORTCUT_GROUP.DIFF,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: ']',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: ']',
    description: 'Jump to the next changed hunk',
  },
  {
    id: REVIEW_SHORTCUT_ID.INLINE_PROMPT,
    group: REVIEW_SHORTCUT_GROUP.DIFF,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: 'k',
    hasCommandModifier: WITH_COMMAND_MODIFIER,
    keyLabel: '⌘K',
    description: 'Prompt the agent about the current diff selection',
  },
  {
    id: REVIEW_SHORTCUT_ID.DISMISS_RUN,
    group: REVIEW_SHORTCUT_GROUP.REVIEW,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: 'd',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: 'd',
    description: 'Dismiss a run that needed no action or failed',
  },
  {
    id: REVIEW_SHORTCUT_ID.APPROVE,
    group: REVIEW_SHORTCUT_GROUP.REVIEW,
    availability: REVIEW_SHORTCUT_AVAILABILITY.REVIEW_GATE,
    keyLabel: 'a',
    description: 'Approve the candidate patch',
  },
  {
    id: REVIEW_SHORTCUT_ID.REJECT,
    group: REVIEW_SHORTCUT_GROUP.REVIEW,
    availability: REVIEW_SHORTCUT_AVAILABILITY.REVIEW_GATE,
    keyLabel: 'r',
    description: 'Reject the candidate patch',
  },
  {
    id: REVIEW_SHORTCUT_ID.SHOW_HELP,
    group: REVIEW_SHORTCUT_GROUP.HELP,
    availability: REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE,
    eventKey: '?',
    hasCommandModifier: NO_COMMAND_MODIFIER,
    keyLabel: '?',
    description: 'Show this shortcut map',
  },
];

export interface UseReviewShortcutsOptions {
  /** Tree navigation, supplied by the Workspace from the comment tree's handle. */
  onFocusNextRow?: () => void;
  onFocusPreviousRow?: () => void;
  onCollapseFocusedRow?: () => void;
  onExpandFocusedRow?: () => void;
  /** Diff-pane actions, owned elsewhere and connected here by the Workspace. */
  onFocusDiffPane?: () => void;
  onPreviousHunk?: () => void;
  onNextHunk?: () => void;
  onInlinePrompt?: () => void;
  /** Omit while the selected run is not dismissable; an absent handler is a no-op. */
  onDismissRun?: () => void;
}

interface UseReviewShortcutsResult {
  isShortcutHelpOpen: boolean;
  onShowShortcutHelp: () => void;
  onCloseShortcutHelp: () => void;
}

type ReviewShortcutHandlers = Partial<Record<ReviewShortcutId, () => void>>;

/** `select` is here for completeness; the app's dropdowns swallow their own keys. */
const TYPING_TAG_NAMES: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Installs the review keyboard. Nothing it can reach touches a real branch: landing
 * stays a two-step whose confirmation is a click, by design rather than by omission.
 *
 * Every handler is optional so the Workspace can connect the panes it currently has;
 * a binding with no handler simply does not fire.
 */
export function useReviewShortcuts({
  onFocusNextRow,
  onFocusPreviousRow,
  onCollapseFocusedRow,
  onExpandFocusedRow,
  onFocusDiffPane,
  onPreviousHunk,
  onNextHunk,
  onInlinePrompt,
  onDismissRun,
}: UseReviewShortcutsOptions = {}): UseReviewShortcutsResult {
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);

  const onShowShortcutHelp = useCallback(() => setIsShortcutHelpOpen(true), []);
  const onCloseShortcutHelp = useCallback(() => setIsShortcutHelpOpen(false), []);

  const handlersById = useMemo<ReviewShortcutHandlers>(
    () => ({
      [REVIEW_SHORTCUT_ID.NEXT_ROW]: onFocusNextRow,
      [REVIEW_SHORTCUT_ID.PREVIOUS_ROW]: onFocusPreviousRow,
      [REVIEW_SHORTCUT_ID.COLLAPSE_ROW]: onCollapseFocusedRow,
      [REVIEW_SHORTCUT_ID.EXPAND_ROW]: onExpandFocusedRow,
      [REVIEW_SHORTCUT_ID.FOCUS_DIFF_PANE]: onFocusDiffPane,
      [REVIEW_SHORTCUT_ID.PREVIOUS_HUNK]: onPreviousHunk,
      [REVIEW_SHORTCUT_ID.NEXT_HUNK]: onNextHunk,
      [REVIEW_SHORTCUT_ID.INLINE_PROMPT]: onInlinePrompt,
      [REVIEW_SHORTCUT_ID.DISMISS_RUN]: onDismissRun,
      [REVIEW_SHORTCUT_ID.SHOW_HELP]: onShowShortcutHelp,
    }),
    [
      onFocusNextRow,
      onFocusPreviousRow,
      onCollapseFocusedRow,
      onExpandFocusedRow,
      onFocusDiffPane,
      onPreviousHunk,
      onNextHunk,
      onInlinePrompt,
      onDismissRun,
      onShowShortcutHelp,
    ],
  );

  useEffect(() => {
    // The map is a modal dialog and owns the keyboard while it is open. Without this,
    // `j` would move the tree behind it and pull focus straight out of the dialog.
    if (isShortcutHelpOpen) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;

      const binding = REVIEW_SHORTCUT_BINDINGS.find((candidate) => matchesEvent(candidate, event));
      if (binding === undefined) return;

      const handler = handlersById[binding.id];
      if (handler === undefined) return;

      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlersById, isShortcutHelpOpen]);

  return { isShortcutHelpOpen, onShowShortcutHelp, onCloseShortcutHelp };
}

/**
 * Reply boxes, follow-up prompts and the PR URL field all sit inside the review
 * surface, so a stray `d` mid-sentence must never reach a run.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAG_NAMES.has(target.tagName)) return true;
  // True on descendants too, which is what catches a rich-text body's inner nodes.
  return target.isContentEditable;
}

function matchesEvent(binding: ReviewShortcutBinding, event: KeyboardEvent): boolean {
  if (binding.availability !== REVIEW_SHORTCUT_AVAILABILITY.AVAILABLE) return false;
  if (binding.eventKey !== event.key) return false;

  // Cmd on macOS, Ctrl elsewhere — the inline prompt matches Cursor's binding rather
  // than inventing one, and Electron ships the same renderer on both platforms.
  const isCommandHeld = event.metaKey || event.ctrlKey;
  if (binding.hasCommandModifier) return isCommandHeld;
  return !isCommandHeld && !event.altKey;
}
