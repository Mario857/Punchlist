import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { IconButton, ICON_BUTTON_SIZE } from '@renderer/components/IconButton';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { ConventionRuleCard } from '@renderer/modules/conventions/ConventionList/components/ConventionRuleCard';
import { useConventionList } from '@renderer/modules/conventions/ConventionList/useConventionList';

const SECTION_LABEL = 'Learned conventions';
const LIST_LABEL = 'Distilled conventions, grouped by category';

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADER_CLASS = 'flex items-center justify-between gap-2';
const HEADING_GROUP_CLASS = 'flex min-w-0 items-baseline gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const COUNT_CLASS = 'text-muted/80 text-xs tabular-nums';
const META_CLASS = 'text-muted text-xs leading-relaxed';
const NOTICE_CLASS = 'text-ink text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';

const ACTION_ROW_CLASS = 'flex flex-wrap items-center gap-2';
const LIST_CLASS = 'flex flex-col gap-4';
const GROUP_CLASS = 'flex flex-col gap-2';
const GROUP_HEADER_CLASS = 'flex flex-wrap items-baseline gap-2';
const GROUP_HEADING_CLASS = 'text-ink text-xs font-semibold tracking-wide uppercase';
const GROUP_COUNT_CLASS = 'text-muted/80 text-xs tabular-nums';
const GROUP_RULES_CLASS = 'flex flex-col gap-2';

/**
 * The distilled corpus, grouped by category. Nothing on this surface writes to a
 * repository: confirming and rejecting are decisions recorded in Punchlist, and the
 * gated write lives in the export card below it.
 */
export function ConventionList() {
  const {
    heading,
    explanation,
    countLabel,
    rejectionNoticeLabel,
    distillLabel,
    distillExplanation,
    isDistilling,
    distillStatusLabel,
    distillErrorMessage,
    onDistillClick,
    refreshLabel,
    isRefreshingConventionRules,
    onRefreshClick,
    groups,
    statusLabel,
    conventionRulesErrorMessage,
    setConventionStateErrorMessage,
  } = useConventionList();

  const groupItems = groups.map((group) => {
    const ruleCards = group.rules.map((rule) => <ConventionRuleCard key={rule.id} item={rule} />);

    return (
      <li key={group.id} className={GROUP_CLASS}>
        <div className={GROUP_HEADER_CLASS}>
          <h4 className={GROUP_HEADING_CLASS}>{group.heading}</h4>
          <span className={GROUP_COUNT_CLASS}>{group.countLabel}</span>
        </div>
        <p className={META_CLASS}>{group.explanation}</p>
        <ol className={GROUP_RULES_CLASS}>{ruleCards}</ol>
      </li>
    );
  });

  const status =
    statusLabel === null ? null : (
      <p role="status" className={META_CLASS}>
        {statusLabel}
      </p>
    );

  const distillStatus =
    distillStatusLabel === null ? null : (
      <p role="status" className={META_CLASS}>
        {distillStatusLabel}
      </p>
    );

  const conventionRulesError =
    conventionRulesErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {conventionRulesErrorMessage}
      </p>
    );

  const distillError =
    distillErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {distillErrorMessage}
      </p>
    );

  const setConventionStateError =
    setConventionStateErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {setConventionStateErrorMessage}
      </p>
    );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD}>
      <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
        <header className={HEADER_CLASS}>
          <div className={HEADING_GROUP_CLASS}>
            <h3 className={HEADING_CLASS}>{heading}</h3>
            <span className={COUNT_CLASS}>{countLabel}</span>
          </div>
          <IconButton
            label={refreshLabel}
            icon={<RefreshIcon />}
            size={ICON_BUTTON_SIZE.SM}
            isLoading={isRefreshingConventionRules}
            onClick={onRefreshClick}
          />
        </header>
        <p className={META_CLASS}>{explanation}</p>
        <p className={NOTICE_CLASS}>{rejectionNoticeLabel}</p>
        <p className={META_CLASS}>{distillExplanation}</p>
        <div className={ACTION_ROW_CLASS}>
          <Button
            variant={BUTTON_VARIANT.SECONDARY}
            size={BUTTON_SIZE.SM}
            isLoading={isDistilling}
            onClick={onDistillClick}
          >
            {distillLabel}
          </Button>
        </div>
        {distillStatus}
        {distillError}
        {setConventionStateError}
        {status}
        {conventionRulesError}
        <ol aria-label={LIST_LABEL} className={LIST_CLASS}>
          {groupItems}
        </ol>
      </section>
    </Card>
  );
}
