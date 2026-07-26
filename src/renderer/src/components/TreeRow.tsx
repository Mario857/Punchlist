import type { CSSProperties, ReactNode, Ref } from 'react';
import { assertNever } from '@renderer/lib/assertNever';
import { joinClassNames } from '@renderer/lib/classNames';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { ChevronDownIcon } from '@renderer/components/icons/ChevronDownIcon';
import { ChevronRightIcon } from '@renderer/components/icons/ChevronRightIcon';
import { CheckIcon } from '@renderer/components/icons/CheckIcon';
import { MinusIcon } from '@renderer/components/icons/MinusIcon';

export const TREE_ROW_CHECKED_STATE = {
  UNCHECKED: 'unchecked',
  CHECKED: 'checked',
  /** A directory whose descendants are only partially selected. */
  INDETERMINATE: 'indeterminate',
} as const;

export type TreeRowCheckedState =
  (typeof TREE_ROW_CHECKED_STATE)[keyof typeof TREE_ROW_CHECKED_STATE];

export interface TreeRowProps {
  label: string;
  /** Zero-based nesting level; drives indentation and `aria-level`. */
  depth: number;
  /** A leaf renders a spacer where the disclosure would be, so labels stay aligned. */
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  /** Omit to render a row that cannot be batch-selected (a directory of nothing actionable). */
  checkedState?: TreeRowCheckedState;
  onCheckedChange?: (isChecked: boolean) => void;
  isSelected?: boolean;
  isDisabled?: boolean;
  onSelect?: () => void;
  /** Folder/file glyph for the diff tree, comment-kind glyph for the comment tree. */
  icon?: ReactNode;
  /** StateBadge plus any muted secondary badges. */
  badges?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Path depth is unbounded, so indentation is an inline custom style rather than a
 * class map — `src/renderer/src/components/icons` alone is five levels deep.
 */
const TREE_ROW_INDENT_REM = 0.75;

const TREE_ROW_ARIA_LEVEL_OFFSET = 1;

/**
 * `as const` matters: without it this widens to `string`, and `aria-checked`
 * accepts only `boolean | 'false' | 'mixed' | 'true'`.
 */
const CHECKBOX_ARIA_CHECKED_MIXED = 'mixed' as const;

const DISCLOSURE_SPACER_CLASS = 'size-5 shrink-0';

/** Both glyphs sit inside small hit targets, so they draw below the 16px icon default. */
const TREE_ROW_DISCLOSURE_ICON_SIZE = 12;
const TREE_ROW_CHECKBOX_ICON_SIZE = 11;

export function TreeRow({
  label,
  depth,
  hasChildren = false,
  isExpanded = false,
  onToggleExpanded,
  checkedState,
  onCheckedChange,
  isSelected = false,
  isDisabled = false,
  onSelect,
  icon,
  badges,
  ref,
}: TreeRowProps) {
  const indentStyle: CSSProperties = { paddingInlineStart: `${depth * TREE_ROW_INDENT_REM}rem` };

  const disclosureIcon = isExpanded ? (
    <ChevronDownIcon size={TREE_ROW_DISCLOSURE_ICON_SIZE} />
  ) : (
    <ChevronRightIcon size={TREE_ROW_DISCLOSURE_ICON_SIZE} />
  );
  const disclosureLabel = isExpanded ? `Collapse ${label}` : `Expand ${label}`;

  const disclosure = hasChildren ? (
    <button
      type="button"
      aria-label={disclosureLabel}
      onClick={onToggleExpanded}
      className={joinClassNames(
        'inline-flex items-center justify-center rounded',
        DISCLOSURE_SPACER_CLASS,
        'text-muted hover:text-ink',
        FOCUS_RING,
        INTERACTIVE_TRANSITION,
      )}
    >
      {disclosureIcon}
    </button>
  ) : (
    <span className={DISCLOSURE_SPACER_CLASS} aria-hidden />
  );

  const checkbox = (() => {
    if (checkedState === undefined) return null;

    const { checkboxIcon, ariaChecked, boxClassName } = (() => {
      switch (checkedState) {
        case TREE_ROW_CHECKED_STATE.CHECKED:
          return {
            checkboxIcon: <CheckIcon size={TREE_ROW_CHECKBOX_ICON_SIZE} />,
            ariaChecked: true,
            boxClassName: 'border-accent bg-accent text-bg-0',
          };
        case TREE_ROW_CHECKED_STATE.INDETERMINATE:
          return {
            checkboxIcon: <MinusIcon size={TREE_ROW_CHECKBOX_ICON_SIZE} />,
            ariaChecked: CHECKBOX_ARIA_CHECKED_MIXED,
            boxClassName: 'border-accent bg-accent/25 text-accent',
          };
        case TREE_ROW_CHECKED_STATE.UNCHECKED:
          return {
            checkboxIcon: null,
            ariaChecked: false,
            boxClassName: 'border-border-strong bg-surface-raised text-transparent',
          };
        default:
          return assertNever(checkedState);
      }
    })();

    const onCheckboxClick = () => {
      onCheckedChange?.(checkedState !== TREE_ROW_CHECKED_STATE.CHECKED);
    };

    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={ariaChecked}
        aria-label={`Select ${label}`}
        disabled={isDisabled}
        onClick={onCheckboxClick}
        className={joinClassNames(
          'inline-flex size-4 shrink-0 items-center justify-center rounded border',
          boxClassName,
          FOCUS_RING,
          INTERACTIVE_TRANSITION,
          DISABLED_STATE,
        )}
      >
        {checkboxIcon}
      </button>
    );
  })();

  const labelClassName = joinClassNames(
    'min-w-0 flex-1 truncate text-left text-sm',
    isSelected ? 'text-ink' : 'text-muted',
  );

  const labelContent = onSelect ? (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onSelect}
      className={joinClassNames(
        labelClassName,
        'rounded',
        FOCUS_RING,
        INTERACTIVE_TRANSITION,
        DISABLED_STATE,
      )}
    >
      {label}
    </button>
  ) : (
    <span className={labelClassName}>{label}</span>
  );

  const ariaExpanded = hasChildren ? isExpanded : undefined;

  return (
    <div
      ref={ref}
      role="treeitem"
      aria-level={depth + TREE_ROW_ARIA_LEVEL_OFFSET}
      aria-selected={isSelected}
      aria-expanded={ariaExpanded}
      style={indentStyle}
      className={joinClassNames(
        'flex w-full items-center gap-1.5 rounded-md py-1 pr-2',
        isSelected ? 'bg-surface-hover' : 'hover:bg-surface-raised',
        INTERACTIVE_TRANSITION,
      )}
    >
      {disclosure}
      {checkbox}
      {icon}
      {labelContent}
      {badges}
    </div>
  );
}
