import { Badge } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { isDefined } from '@renderer/lib/guards';
import { joinClassNames } from '@renderer/lib/classNames';
import type { TierModelRowModel } from '@renderer/modules/settings/TierModelMapping/useTierModelMapping';

const FREE_LANE_RESET_LABEL = 'Use the free-lane default';

const REASONING_EFFORT_HINT =
  'Read from this model’s own parameters, so it appears only where the model offers one. Turning effort down on mechanical work is a real lever, and it stays inside the unlimited lane.';

const SELECT_BASE_CLASS = joinClassNames(
  'h-9 min-w-0 rounded-md border px-2',
  'text-sm',
  'border-border bg-surface-raised text-ink',
  'hover:border-border-strong',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const MODEL_SELECT_CLASS = joinClassNames(SELECT_BASE_CLASS, 'flex-1');
const EFFORT_SELECT_CLASS = joinClassNames(SELECT_BASE_CLASS, 'mt-1.5 w-full');

const CONTROL_LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const HINT_CLASS = 'text-muted mt-1.5 text-xs leading-relaxed';

const NOTICE_CLASS = 'mt-3 flex items-start gap-2 rounded-md border p-3 text-xs leading-relaxed';
const UNAVAILABLE_NOTICE_CLASS = joinClassNames(
  NOTICE_CLASS,
  'border-warning/40 bg-warning/10 text-warning',
);
/** Loud on purpose: a muted badge cannot carry "this selection costs money". */
const POOL_SPENDING_NOTICE_CLASS = joinClassNames(
  NOTICE_CLASS,
  'border-danger/50 bg-danger/10 text-danger',
);

export interface TierModelRowProps {
  row: TierModelRowModel;
}

export function TierModelRow({ row }: TierModelRowProps) {
  const modelOptionGroupElements = row.modelOptionGroups.map((group) => {
    const optionElements = group.options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ));
    return (
      <optgroup key={group.label} label={group.label}>
        {optionElements}
      </optgroup>
    );
  });

  const freeLaneResetButton = row.isFreeLaneResetVisible ? (
    <Button
      size={BUTTON_SIZE.SM}
      variant={BUTTON_VARIANT.SECONDARY}
      isDisabled={row.isDisabled}
      onClick={row.onFreeLaneResetClick}
    >
      {FREE_LANE_RESET_LABEL}
    </Button>
  ) : null;

  const reasoningEffortControl = row.reasoningEffortControl;
  const reasoningEffortOptionElements = isDefined(reasoningEffortControl)
    ? reasoningEffortControl.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))
    : null;

  const reasoningEffortBlock = isDefined(reasoningEffortControl) ? (
    <div className="mt-3">
      <label htmlFor={reasoningEffortControl.selectId} className={CONTROL_LABEL_CLASS}>
        {reasoningEffortControl.label}
      </label>
      <select
        id={reasoningEffortControl.selectId}
        value={reasoningEffortControl.value}
        disabled={row.isDisabled}
        onChange={row.onReasoningEffortChange}
        className={EFFORT_SELECT_CLASS}
      >
        {reasoningEffortOptionElements}
      </select>
      <p className={HINT_CLASS}>{REASONING_EFFORT_HINT}</p>
    </div>
  ) : null;

  const unavailableModelNotice = isDefined(row.unavailableModelNotice) ? (
    <p role="alert" className={UNAVAILABLE_NOTICE_CLASS}>
      <AlertTriangleIcon className="mt-0.5 shrink-0" />
      {row.unavailableModelNotice}
    </p>
  ) : null;

  const poolSpendingNotice = isDefined(row.poolSpendingWarning) ? (
    <p role="alert" className={POOL_SPENDING_NOTICE_CLASS}>
      <AlertTriangleIcon className="mt-0.5 shrink-0" />
      {row.poolSpendingWarning}
    </p>
  ) : null;

  return (
    <li className="border-border/70 rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={row.modelSelectId} className="text-ink text-sm font-medium">
            {row.tierLabel}
          </label>
          <p className="text-muted mt-1 text-xs leading-relaxed">{row.tierDescription}</p>
        </div>
        <Badge tone={row.laneBadgeTone} isMuted={row.isLaneBadgeMuted}>
          {row.laneBadgeLabel}
        </Badge>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          id={row.modelSelectId}
          value={row.modelValue}
          disabled={row.isDisabled}
          onChange={row.onModelChange}
          className={MODEL_SELECT_CLASS}
        >
          {modelOptionGroupElements}
        </select>
        {freeLaneResetButton}
      </div>

      {reasoningEffortBlock}
      {unavailableModelNotice}
      {poolSpendingNotice}
    </li>
  );
}
