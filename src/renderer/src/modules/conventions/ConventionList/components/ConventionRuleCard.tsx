import { Badge, type BadgeTone } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, type ButtonVariant } from '@renderer/components/Button';
import { joinClassNames } from '@renderer/lib/classNames';
import {
  ConventionEvidence,
  type ConventionEvidenceView,
} from '@renderer/modules/conventions/ConventionList/components/ConventionEvidence';

export interface ConventionRuleActionItem {
  id: string;
  label: string;
  /**
   * Appended screen-reader-only, so a column of buttons all reading "Confirm" is not a
   * column of twenty identical accessible names.
   */
  accessibleSuffix: string;
  variant: ButtonVariant;
  isDisabled: boolean;
  onClick: () => void;
}

export interface ConventionRuleItem {
  id: string;
  /** Imperative, one rule per record — the sentence a future agent is handed. */
  rule: string;
  rationale: string;
  /** A user-level file applies to everything you write, so those rules are framed apart. */
  isGlobal: boolean;
  /** Undecided rather than broken, so a candidate is framed quieter, not louder. */
  isCandidate: boolean;
  scopeLabel: string;
  scopeTone: BadgeTone;
  isScopeBadgeMuted: boolean;
  scopeExplanation: string;
  stateLabel: string;
  stateTone: BadgeTone;
  isStateBadgeMuted: boolean;
  stateExplanation: string;
  evidenceCountLabel: string;
  /** Non-null only below the recurrence threshold: how much more it needs, not a fault. */
  recurrenceShortfallLabel: string | null;
  /** Non-null once a repo rule has recurred in a second repository. */
  promotionLabel: string | null;
  updatedLabel: string;
  /** The machine-readable timestamp for `<time dateTime>`. */
  updatedTimestamp: string;
  evidence: ConventionEvidenceView;
  actions: ConventionRuleActionItem[];
}

export interface ConventionRuleCardProps {
  item: ConventionRuleItem;
}

const ITEM_BASE_CLASS = 'flex flex-col gap-2 rounded-md border p-3';
/** Solid and opaque: this rule has been decided and is what an export writes. */
const DECIDED_FRAME_CLASS = 'border-border bg-surface';
/** Dashed and quieter, so "not enough evidence yet" never reads as "something is wrong". */
const CANDIDATE_FRAME_CLASS = 'border-border bg-surface-raised border-dashed';
/**
 * A thick accent rule down the left, the same device the audit log uses to say "these
 * rows are one act": a global convention is written to a user-level file that applies to
 * everything you write, which is a different commitment from a repository's own rule.
 */
const GLOBAL_FRAME_CLASS = 'border-l-4 border-l-accent';
const REPO_FRAME_CLASS = '';

const HEADER_CLASS = 'flex flex-wrap items-center gap-2';
const TIME_CLASS = 'text-muted ml-auto text-xs';
const RULE_CLASS = 'text-ink text-sm leading-relaxed break-words';
const RATIONALE_CLASS = 'text-muted text-xs leading-relaxed break-words';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const EVIDENCE_COUNT_CLASS = 'text-ink text-xs font-medium';
const SHORTFALL_CLASS = 'text-warning text-xs leading-relaxed';
const PROMOTION_CLASS = 'text-accent text-xs leading-relaxed';
const ACTION_ROW_CLASS = 'flex flex-wrap items-center gap-2';
const SCREEN_READER_ONLY_CLASS = 'sr-only';

/**
 * One distilled convention: what it says, why, how much evidence stands behind it, and
 * the decisions available on it. The scope and state badges carry text as well as
 * colour, because "this will be written into a file that governs everything you write"
 * is not something a hue is allowed to say on its own.
 */
export function ConventionRuleCard({ item }: ConventionRuleCardProps) {
  const itemClass = joinClassNames(
    ITEM_BASE_CLASS,
    item.isCandidate ? CANDIDATE_FRAME_CLASS : DECIDED_FRAME_CLASS,
    item.isGlobal ? GLOBAL_FRAME_CLASS : REPO_FRAME_CLASS,
  );

  const shortfall =
    item.recurrenceShortfallLabel === null ? null : (
      <p className={SHORTFALL_CLASS}>{item.recurrenceShortfallLabel}</p>
    );

  const promotion =
    item.promotionLabel === null ? null : <p className={PROMOTION_CLASS}>{item.promotionLabel}</p>;

  const actionButtons = item.actions.map((action) => (
    <Button
      key={action.id}
      variant={action.variant}
      size={BUTTON_SIZE.SM}
      isDisabled={action.isDisabled}
      onClick={action.onClick}
    >
      {action.label}
      <span className={SCREEN_READER_ONLY_CLASS}>{action.accessibleSuffix}</span>
    </Button>
  ));

  return (
    <li className={itemClass}>
      <div className={HEADER_CLASS}>
        <Badge tone={item.stateTone} isMuted={item.isStateBadgeMuted}>
          {item.stateLabel}
        </Badge>
        <Badge tone={item.scopeTone} isMuted={item.isScopeBadgeMuted}>
          {item.scopeLabel}
        </Badge>
        <time dateTime={item.updatedTimestamp} className={TIME_CLASS}>
          {item.updatedLabel}
        </time>
      </div>
      <p className={RULE_CLASS}>{item.rule}</p>
      <p className={RATIONALE_CLASS}>{item.rationale}</p>
      <p className={EXPLANATION_CLASS}>{item.scopeExplanation}</p>
      <p className={EXPLANATION_CLASS}>{item.stateExplanation}</p>
      <p className={EVIDENCE_COUNT_CLASS}>{item.evidenceCountLabel}</p>
      {shortfall}
      {promotion}
      <ConventionEvidence view={item.evidence} />
      <div className={ACTION_ROW_CLASS}>{actionButtons}</div>
    </li>
  );
}
