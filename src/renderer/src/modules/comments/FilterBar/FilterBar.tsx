import type { PrComment } from '@shared/comments';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Toggle, TOGGLE_SIZE } from '@renderer/components/Toggle';
import { XIcon } from '@renderer/components/icons/XIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useFilterBar } from './useFilterBar';

export interface FilterBarProps {
  /** The full fetched set: it backs both the option lists and the triage counter. */
  comments: PrComment[];
}

const UNRESOLVED_ONLY_LABEL = 'Unresolved only';
const HIDE_BOTS_LABEL = 'Hide bots';
const HIDE_OUTDATED_LABEL = 'Hide outdated';
const AUTHOR_LABEL = 'Author';
const FILE_LABEL = 'File';
const CLEAR_FILTERS_LABEL = 'Clear filters';

/** Matches the small badge glyphs, so the bar's marks agree with the rows below it. */
const CLEAR_ICON_SIZE = 11;

const BAR_CLASS = 'border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-2 py-2';
const FIELD_CLASS = 'inline-flex items-center gap-1.5';
const FIELD_LABEL_CLASS = 'text-muted text-xs';
const TRIAGE_CLASS = 'text-muted ml-auto text-xs tabular-nums';

const SELECT_CLASS = joinClassNames(
  'h-7 max-w-40 truncate rounded-md border px-1.5 text-xs',
  'border-border bg-surface-raised text-ink',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
);

export function FilterBar({ comments }: FilterBarProps) {
  const {
    isUnresolvedOnly,
    shouldHideBots,
    shouldHideOutdated,
    authorValue,
    authorOptions,
    pathValue,
    pathOptions,
    triageLabel,
    hasActiveFilters,
    onUnresolvedOnlyChange,
    onHideBotsChange,
    onHideOutdatedChange,
    onAuthorChange,
    onPathChange,
    onClearFilters,
  } = useFilterBar(comments);

  const authorOptionItems = authorOptions.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));

  const pathOptionItems = pathOptions.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));

  const clearButton = hasActiveFilters ? (
    <Button
      variant={BUTTON_VARIANT.GHOST}
      size={BUTTON_SIZE.SM}
      icon={<XIcon size={CLEAR_ICON_SIZE} />}
      onClick={onClearFilters}
    >
      {CLEAR_FILTERS_LABEL}
    </Button>
  ) : null;

  return (
    <div className={BAR_CLASS}>
      <Toggle
        size={TOGGLE_SIZE.SM}
        isChecked={isUnresolvedOnly}
        onChange={onUnresolvedOnlyChange}
        label={UNRESOLVED_ONLY_LABEL}
      />
      <Toggle
        size={TOGGLE_SIZE.SM}
        isChecked={shouldHideBots}
        onChange={onHideBotsChange}
        label={HIDE_BOTS_LABEL}
      />
      <Toggle
        size={TOGGLE_SIZE.SM}
        isChecked={shouldHideOutdated}
        onChange={onHideOutdatedChange}
        label={HIDE_OUTDATED_LABEL}
      />
      <label className={FIELD_CLASS}>
        <span className={FIELD_LABEL_CLASS}>{AUTHOR_LABEL}</span>
        <select value={authorValue} onChange={onAuthorChange} className={SELECT_CLASS}>
          {authorOptionItems}
        </select>
      </label>
      <label className={FIELD_CLASS}>
        <span className={FIELD_LABEL_CLASS}>{FILE_LABEL}</span>
        <select value={pathValue} onChange={onPathChange} className={SELECT_CLASS}>
          {pathOptionItems}
        </select>
      </label>
      <span className={TRIAGE_CLASS}>{triageLabel}</span>
      {clearButton}
    </div>
  );
}
