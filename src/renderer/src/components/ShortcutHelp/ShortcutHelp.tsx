import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { joinClassNames } from '@renderer/lib/classNames';
import { useShortcutHelp } from './useShortcutHelp';

export interface ShortcutHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_HELP_TITLE_ID = 'shortcut-help-title';
const SHORTCUT_HELP_TITLE = 'Keyboard shortcuts';
const CLOSE_LABEL = 'Close';

/**
 * Escape is the dialog's own, not a global binding, so it is a note rather than a
 * table row: the review keyboard is deliberately inert while this map is open.
 */
const DISMISS_NOTE = 'Press Esc to close this map.';

/** Stated in the map itself, because the gate is the one thing that must not become muscle memory. */
const LANDING_NOTE = 'Landing stays a two-step: no shortcut applies work to a real branch.';

const DIALOG_CLASS = joinClassNames(
  'w-full max-w-lg rounded-lg p-0',
  'border border-border bg-surface text-ink shadow-xl',
  'backdrop:bg-bg-0/70',
);

const HEADER_CLASS = 'border-border flex items-center justify-between gap-4 border-b px-4 py-3';
const TITLE_CLASS = 'text-ink text-sm font-medium';
const BODY_CLASS = 'flex max-h-96 flex-col gap-4 overflow-y-auto px-4 py-3';
const SECTION_TITLE_CLASS = 'text-muted mb-1.5 text-xs font-medium tracking-wide uppercase';
const ROW_CLASS = 'flex items-center gap-3 py-1';
const KEY_CLASS = joinClassNames(
  'inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded px-1.5',
  'border-border-strong bg-surface-raised text-ink border font-mono text-xs',
);
const DESCRIPTION_CLASS = 'text-muted min-w-0 flex-1 text-sm';
const PENDING_NOTE_CLASS = 'text-muted/70 shrink-0 text-xs italic';
const FOOTER_CLASS = 'border-border text-muted flex flex-col gap-1 border-t px-4 py-3 text-xs';

/**
 * A real modal dialog rather than a styled div: `showModal` is what makes it labelled,
 * focus-trapped and escapable without hand-rolling any of the three.
 */
export function ShortcutHelp({ isOpen, onClose }: ShortcutHelpProps) {
  const { dialogRef, groups } = useShortcutHelp(isOpen);

  const groupItems = groups.map((group) => {
    const rowItems = group.rows.map((row) => {
      const pendingNote =
        row.pendingNote === null ? null : (
          <span className={PENDING_NOTE_CLASS}>{row.pendingNote}</span>
        );

      return (
        <div key={row.id} className={ROW_CLASS}>
          <kbd className={KEY_CLASS}>{row.keyLabel}</kbd>
          <span className={DESCRIPTION_CLASS}>{row.description}</span>
          {pendingNote}
        </div>
      );
    });

    return (
      <section key={group.name}>
        <h3 className={SECTION_TITLE_CLASS}>{group.name}</h3>
        {rowItems}
      </section>
    );
  });

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={SHORTCUT_HELP_TITLE_ID}
      onClose={onClose}
      className={DIALOG_CLASS}
    >
      <div className={HEADER_CLASS}>
        <h2 id={SHORTCUT_HELP_TITLE_ID} className={TITLE_CLASS}>
          {SHORTCUT_HELP_TITLE}
        </h2>
        <Button variant={BUTTON_VARIANT.GHOST} size={BUTTON_SIZE.SM} onClick={onClose}>
          {CLOSE_LABEL}
        </Button>
      </div>
      <div className={BODY_CLASS}>{groupItems}</div>
      <div className={FOOTER_CLASS}>
        <p>{DISMISS_NOTE}</p>
        <p>{LANDING_NOTE}</p>
      </div>
    </dialog>
  );
}
