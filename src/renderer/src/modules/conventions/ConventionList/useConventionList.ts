import { useEffect } from 'react';
import {
  CONFIRMABLE_EVIDENCE_THRESHOLD,
  CONVENTION_CATEGORY,
  CONVENTION_SCOPE,
  CONVENTION_STATE,
  isConfirmable,
  shouldPromoteToGlobal,
  type ConventionCategory,
  type ConventionRule,
  type ConventionState,
} from '@shared/conventions';
import { BADGE_TONE, type BadgeTone } from '@renderer/components/Badge';
import { BUTTON_VARIANT } from '@renderer/components/Button';
import { assertNever } from '@renderer/lib/assertNever';
import { groupBy } from '@renderer/lib/collections';
import { formatDateTime } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { logError } from '@renderer/lib/logError';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import type { ConventionEvidenceView } from '@renderer/modules/conventions/ConventionList/components/ConventionEvidence';
import type {
  ConventionRuleActionItem,
  ConventionRuleItem,
} from '@renderer/modules/conventions/ConventionList/components/ConventionRuleCard';
import {
  useExecuteDistillConventions,
  useExecuteSetConventionState,
  useQueryConventions,
  type SetConventionStateRequest,
} from '@renderer/modules/conventions/useQueryConventions';

export interface ConventionCategoryGroupItem {
  id: string;
  heading: string;
  explanation: string;
  countLabel: string;
  rules: ConventionRuleItem[];
}

interface UseConventionListResult {
  heading: string;
  explanation: string;
  countLabel: string;
  /** Says plainly that a rejection is remembered rather than deleted. */
  rejectionNoticeLabel: string;
  distillLabel: string;
  distillExplanation: string;
  isDistilling: boolean;
  distillStatusLabel: string | null;
  distillErrorMessage: string | null;
  onDistillClick: () => void;
  refreshLabel: string;
  isRefreshingConventionRules: boolean;
  onRefreshClick: () => void;
  groups: ConventionCategoryGroupItem[];
  /** Non-null while the corpus is loading or empty, neither of which is an error. */
  statusLabel: string | null;
  conventionRulesErrorMessage: string | null;
  setConventionStateErrorMessage: string | null;
}

const HEADING = 'Learned conventions';
const EXPLANATION =
  'Every review comment Airlock ingested is a statement about how your code is supposed to look. These are the durable rules distilled out of that corpus, ready to hand to a future coding agent as project context instead of being re-learned on every task.';
const REJECTION_NOTICE =
  'Rejecting is remembered, not deleted. A rejected rule stays on file precisely so distillation never proposes it again, and the comments behind it are untouched — you can return it to a candidate at any time.';

const DISTILL_LABEL = 'Distil new comments into rules';
const DISTILL_EXPLANATION =
  'Runs one agent over every comment that has not been distilled yet, in one batch so it can deduplicate rather than emit twenty near-identical naming rules. It is not instant — expect to wait. It stays in the free lane, so what it costs is time and a concurrency slot, not money.';
const DISTILLING_LABEL =
  'Distilling… one agent is reading the undistilled comments. This takes a while; the list updates when it finishes.';
const DISTILLED_LABEL =
  'Distillation finished. Anything new is below as a candidate, and anything that recurred bumped an existing rule instead of duplicating it.';

const REFRESH_LABEL = 'Refresh the distilled conventions';

const LOADING_LABEL = 'Reading the distilled conventions…';
const EMPTY_LABEL =
  'No conventions yet. Evidence is captured from every PR you ingest, so there may already be plenty to work with — distil it and the candidates appear here.';

const CONVENTION_RULES_ERROR_FALLBACK = 'Could not read the distilled conventions.';
const DISTILL_ERROR_FALLBACK = 'Distillation failed, so no rules were proposed.';
const SET_STATE_ERROR_FALLBACK = 'Could not record that decision.';

const SINGLE_RULE_COUNT_LABEL = '1 rule';
const RULE_COUNT_SUFFIX = ' rules';
const SINGLE_COMMENT_COUNT_LABEL = '1 comment';
const COMMENT_COUNT_SUFFIX = ' comments';
const SINGLE_REPOSITORY_COUNT_LABEL = '1 repository';
const REPOSITORY_COUNT_SUFFIX = ' repositories';
const NO_COUNT_LABEL = '';

const EVIDENCE_COUNT_PREFIX = 'Backed by ';
const EVIDENCE_COUNT_SEPARATOR = ' across ';

const SHORTFALL_PREFIX = 'Not enough evidence yet — ';
const SHORTFALL_MIDDLE = ' more ';
const SHORTFALL_SUFFIX =
  ' saying the same thing before this can be confirmed. Nothing is wrong with it: one reviewer is an opinion, and the same instruction three times is a convention.';
const SINGLE_COMMENT_NOUN = 'comment';
const COMMENT_NOUN = 'comments';

const PROMOTION_PREFIX = 'Seen in ';
const PROMOTION_SUFFIX =
  ' — it has recurred outside a single repository, which is what lifts a repo rule to global. Nothing is born global.';

const UPDATED_LABEL_PREFIX = 'Updated ';

const EVIDENCE_SUMMARY_PREFIX = 'Evidence — ';
const EVIDENCE_EXPLANATION =
  'The review comments this rule was distilled from. Their ids are listed as stored; the repositories they came from are linked, which is as deep as a rule alone can point, because a rule keeps the ids of its evidence rather than each comment URL.';
const EVIDENCE_REPOSITORIES_LABEL = 'Repositories';
const EVIDENCE_COMMENTS_LABEL = 'Source comment ids';
const NO_EVIDENCE_REPOSITORIES_LABEL = 'No repository was recorded with this rule.';
const NO_EVIDENCE_COMMENTS_LABEL = 'No source comment was recorded with this rule.';
const REPOSITORY_LINK_LABEL_PREFIX = 'Open ';
const REPOSITORY_LINK_LABEL_SUFFIX = ' on GitHub';
const GITHUB_REPO_URL_PREFIX = 'https://github.com/';

const REPO_SCOPE_LABEL_PREFIX = 'Repo — ';
const UNKNOWN_REPO_LABEL = 'unknown repository';
const REPO_SCOPE_EXPLANATION =
  'Scoped to one repository. It is written into that repository rules file and nowhere else.';
const GLOBAL_SCOPE_LABEL = 'Global — everything you write';
const GLOBAL_SCOPE_EXPLANATION =
  'Cross-repo. Exporting it writes it to a standalone user-level file that applies to every project you work on, which is a heavier commitment than a rule scoped to one repository.';

const CONFIRM_ACTION_LABEL = 'Confirm';
const REJECT_ACTION_LABEL = 'Reject';
const RECONSIDER_ACTION_LABEL = 'Return to candidate';
const ACTION_ACCESSIBLE_SUFFIX_PREFIX = ' the rule: ';

const ACTION_ID = {
  CONFIRM: 'confirm',
  REJECT: 'reject',
  RECONSIDER: 'reconsider',
} as const;

const GROUP_ID_PREFIX = 'category';
const GROUP_ID_SEPARATOR = ':';

const SINGLE_ITEM_COUNT = 1;
const EMPTY_COUNT = 0;
const NO_SHORTFALL = 0;

/** Rendered in this order so the list reads the same way every time it is opened. */
const CATEGORY_ORDER: readonly ConventionCategory[] = [
  CONVENTION_CATEGORY.NAMING,
  CONVENTION_CATEGORY.STRUCTURE,
  CONVENTION_CATEGORY.TYPING,
  CONVENTION_CATEGORY.TESTING,
  CONVENTION_CATEGORY.STYLING,
  CONVENTION_CATEGORY.PROCESS,
  CONVENTION_CATEGORY.SECURITY,
];

/**
 * Decided rules first and rejections last: a rejection is kept so distillation can read
 * it, not because it is something to re-read every time the list is opened.
 */
const STATE_ORDER: readonly ConventionState[] = [
  CONVENTION_STATE.CONFIRMED,
  CONVENTION_STATE.EXPORTED,
  CONVENTION_STATE.CANDIDATE,
  CONVENTION_STATE.REJECTED,
];

/** A stable identity, so an unfetched corpus does not rebuild the list every render. */
const EMPTY_RULES: readonly ConventionRule[] = [];

function toRuleCountLabel(count: number): string {
  if (count === EMPTY_COUNT) return NO_COUNT_LABEL;
  if (count === SINGLE_ITEM_COUNT) return SINGLE_RULE_COUNT_LABEL;
  return `${count}${RULE_COUNT_SUFFIX}`;
}

function toCommentCountLabel(count: number): string {
  if (count === SINGLE_ITEM_COUNT) return SINGLE_COMMENT_COUNT_LABEL;
  return `${count}${COMMENT_COUNT_SUFFIX}`;
}

function toRepositoryCountLabel(count: number): string {
  if (count === SINGLE_ITEM_COUNT) return SINGLE_REPOSITORY_COUNT_LABEL;
  return `${count}${REPOSITORY_COUNT_SUFFIX}`;
}

interface ConventionCategoryPresentation {
  heading: string;
  explanation: string;
}

/**
 * A `switch` rather than a lookup record, so a new `CONVENTION_CATEGORY` member is a
 * compile error here. The categories exist because the exported file has sections —
 * grouping is a property of the model, not something this view invented.
 */
function toCategoryPresentation(category: ConventionCategory): ConventionCategoryPresentation {
  switch (category) {
    case CONVENTION_CATEGORY.NAMING:
      return {
        heading: 'Naming',
        explanation: 'What things are called: files, symbols, booleans, components.',
      };
    case CONVENTION_CATEGORY.STRUCTURE:
      return {
        heading: 'Structure',
        explanation: 'Where code is allowed to live, and which layer may import which.',
      };
    case CONVENTION_CATEGORY.TYPING:
      return {
        heading: 'Typing',
        explanation: 'How the type system is used, and what it is expected to prove.',
      };
    case CONVENTION_CATEGORY.TESTING:
      return {
        heading: 'Testing',
        explanation: 'What has to be verified before a change is considered done.',
      };
    case CONVENTION_CATEGORY.STYLING:
      return {
        heading: 'Styling',
        explanation: 'How the interface is styled, and which tokens are the source of truth.',
      };
    case CONVENTION_CATEGORY.PROCESS:
      return {
        heading: 'Process',
        explanation: 'How changes are proposed, reviewed and landed.',
      };
    case CONVENTION_CATEGORY.SECURITY:
      return {
        heading: 'Security',
        explanation: 'What must never be logged, committed, or widened.',
      };
    default:
      return assertNever(category);
  }
}

interface ConventionScopePresentation {
  label: string;
  explanation: string;
  tone: BadgeTone;
  isMuted: boolean;
  isGlobal: boolean;
}

/**
 * Global reads strong and repo reads muted, because the two are different promises: one
 * governs a repository, the other governs everything you write.
 */
function toScopePresentation(rule: ConventionRule): ConventionScopePresentation {
  switch (rule.scope) {
    case CONVENTION_SCOPE.REPO:
      return {
        // Null exactly when the scope is global, so a repo rule without a key is
        // malformed store data rather than a case to render as a blank badge.
        label: `${REPO_SCOPE_LABEL_PREFIX}${rule.repoKey ?? UNKNOWN_REPO_LABEL}`,
        explanation: REPO_SCOPE_EXPLANATION,
        tone: BADGE_TONE.NEUTRAL,
        isMuted: true,
        isGlobal: false,
      };
    case CONVENTION_SCOPE.GLOBAL:
      return {
        label: GLOBAL_SCOPE_LABEL,
        explanation: GLOBAL_SCOPE_EXPLANATION,
        tone: BADGE_TONE.ACCENT,
        isMuted: false,
        isGlobal: true,
      };
    default:
      return assertNever(rule.scope);
  }
}

interface ConventionStatePresentation {
  label: string;
  explanation: string;
  tone: BadgeTone;
  isMuted: boolean;
  isCandidate: boolean;
}

function toStatePresentation(state: ConventionState): ConventionStatePresentation {
  switch (state) {
    case CONVENTION_STATE.CANDIDATE:
      return {
        label: 'Candidate',
        explanation:
          'Proposed by distillation and not decided yet. A candidate is never exported and never handed to an agent, so leaving it here changes nothing.',
        tone: BADGE_TONE.NEUTRAL,
        isMuted: true,
        isCandidate: true,
      };
    case CONVENTION_STATE.CONFIRMED:
      return {
        label: 'Confirmed',
        explanation: 'Accepted. Confirmed rules are the only ones an export writes.',
        tone: BADGE_TONE.SUCCESS,
        isMuted: false,
        isCandidate: false,
      };
    case CONVENTION_STATE.REJECTED:
      return {
        label: 'Rejected',
        explanation:
          'Dismissed and remembered. Distillation reads this so it never proposes the rule again — nothing was deleted, and its evidence is still on file.',
        tone: BADGE_TONE.DANGER,
        isMuted: true,
        isCandidate: false,
      };
    case CONVENTION_STATE.EXPORTED:
      return {
        label: 'Exported',
        explanation:
          'Already written into a rules file. It stays in the corpus so the next export rewrites it rather than dropping it.',
        tone: BADGE_TONE.INFO,
        isMuted: false,
        isCandidate: false,
      };
    default:
      return assertNever(state);
  }
}

/** How much evidence a rule carries, in the one phrasing both the row and its disclosure use. */
function toEvidenceCountLabel(rule: ConventionRule): string {
  const commentCountLabel = toCommentCountLabel(rule.evidenceCommentIds.length);
  const repositoryCountLabel = toRepositoryCountLabel(rule.evidenceRepoKeys.length);
  return `${commentCountLabel}${EVIDENCE_COUNT_SEPARATOR}${repositoryCountLabel}`;
}

/** Null once a rule has recurred enough to be confirmable; otherwise how far off it is. */
function toShortfallLabel(rule: ConventionRule): string | null {
  if (isConfirmable(rule)) return null;

  const remaining = CONFIRMABLE_EVIDENCE_THRESHOLD - rule.evidenceCommentIds.length;
  if (remaining <= NO_SHORTFALL) return null;

  const noun = remaining === SINGLE_ITEM_COUNT ? SINGLE_COMMENT_NOUN : COMMENT_NOUN;
  return `${SHORTFALL_PREFIX}${remaining}${SHORTFALL_MIDDLE}${noun}${SHORTFALL_SUFFIX}`;
}

/** Only ever set on a repo rule: a global rule has already been promoted. */
function toPromotionLabel(rule: ConventionRule): string | null {
  if (rule.scope === CONVENTION_SCOPE.GLOBAL) return null;
  if (!shouldPromoteToGlobal(rule)) return null;
  return `${PROMOTION_PREFIX}${toRepositoryCountLabel(rule.evidenceRepoKeys.length)}${PROMOTION_SUFFIX}`;
}

function toEvidenceView(rule: ConventionRule): ConventionEvidenceView {
  return {
    summaryLabel: `${EVIDENCE_SUMMARY_PREFIX}${toEvidenceCountLabel(rule)}`,
    explanation: EVIDENCE_EXPLANATION,
    repositoriesLabel: EVIDENCE_REPOSITORIES_LABEL,
    repositories: rule.evidenceRepoKeys.map((repoKey) => ({
      repoKey,
      url: `${GITHUB_REPO_URL_PREFIX}${repoKey}`,
      linkLabel: `${REPOSITORY_LINK_LABEL_PREFIX}${repoKey}${REPOSITORY_LINK_LABEL_SUFFIX}`,
    })),
    hasRepositories: rule.evidenceRepoKeys.length > EMPTY_COUNT,
    noRepositoriesLabel: NO_EVIDENCE_REPOSITORIES_LABEL,
    commentsLabel: EVIDENCE_COMMENTS_LABEL,
    comments: rule.evidenceCommentIds.map((commentId) => ({ commentId })),
    hasComments: rule.evidenceCommentIds.length > EMPTY_COUNT,
    noCommentsLabel: NO_EVIDENCE_COMMENTS_LABEL,
  };
}

interface ConventionRuleActionOptions {
  rule: ConventionRule;
  isPending: boolean;
  onSetState: (request: SetConventionStateRequest) => void;
}

/**
 * Which decisions a rule offers follows from the state it is in, exhaustively, so a new
 * `CONVENTION_STATE` member cannot silently render a rule with no way out of it.
 * Confirming is gated on the recurrence threshold rather than hidden: the rule is a real
 * candidate, it simply has not recurred often enough yet to be worth carrying.
 */
function toActions({
  rule,
  isPending,
  onSetState,
}: ConventionRuleActionOptions): ConventionRuleActionItem[] {
  const accessibleSuffix = `${ACTION_ACCESSIBLE_SUFFIX_PREFIX}${rule.rule}`;

  const confirm: ConventionRuleActionItem = {
    id: ACTION_ID.CONFIRM,
    label: CONFIRM_ACTION_LABEL,
    accessibleSuffix,
    variant: BUTTON_VARIANT.PRIMARY,
    isDisabled: isPending || !isConfirmable(rule),
    onClick: () => onSetState({ ruleId: rule.id, state: CONVENTION_STATE.CONFIRMED }),
  };

  const reject: ConventionRuleActionItem = {
    id: ACTION_ID.REJECT,
    label: REJECT_ACTION_LABEL,
    accessibleSuffix,
    variant: BUTTON_VARIANT.DANGER,
    isDisabled: isPending,
    onClick: () => onSetState({ ruleId: rule.id, state: CONVENTION_STATE.REJECTED }),
  };

  const reconsider: ConventionRuleActionItem = {
    id: ACTION_ID.RECONSIDER,
    label: RECONSIDER_ACTION_LABEL,
    accessibleSuffix,
    variant: BUTTON_VARIANT.SECONDARY,
    isDisabled: isPending,
    onClick: () => onSetState({ ruleId: rule.id, state: CONVENTION_STATE.CANDIDATE }),
  };

  switch (rule.state) {
    case CONVENTION_STATE.CANDIDATE:
      return [confirm, reject];
    case CONVENTION_STATE.CONFIRMED:
      return [reject, reconsider];
    case CONVENTION_STATE.REJECTED:
      return [confirm, reconsider];
    case CONVENTION_STATE.EXPORTED:
      return [reject, reconsider];
    default:
      return assertNever(rule.state);
  }
}

interface ConventionRuleItemOptions {
  rule: ConventionRule;
  isPending: boolean;
  onSetState: (request: SetConventionStateRequest) => void;
}

function toRuleItem({
  rule,
  isPending,
  onSetState,
}: ConventionRuleItemOptions): ConventionRuleItem {
  const scope = toScopePresentation(rule);
  const state = toStatePresentation(rule.state);

  return {
    id: rule.id,
    rule: rule.rule,
    rationale: rule.rationale,
    isGlobal: scope.isGlobal,
    isCandidate: state.isCandidate,
    scopeLabel: scope.label,
    scopeTone: scope.tone,
    isScopeBadgeMuted: scope.isMuted,
    scopeExplanation: scope.explanation,
    stateLabel: state.label,
    stateTone: state.tone,
    isStateBadgeMuted: state.isMuted,
    stateExplanation: state.explanation,
    evidenceCountLabel: `${EVIDENCE_COUNT_PREFIX}${toEvidenceCountLabel(rule)}`,
    recurrenceShortfallLabel: toShortfallLabel(rule),
    promotionLabel: toPromotionLabel(rule),
    updatedLabel: `${UPDATED_LABEL_PREFIX}${formatDateTime(rule.updatedAt)}`,
    updatedTimestamp: rule.updatedAt,
    evidence: toEvidenceView(rule),
    actions: toActions({ rule, isPending, onSetState }),
  };
}

/**
 * The distilled corpus, grouped by category because the exported file has sections and
 * the grouping is therefore already part of the model rather than a view decision.
 *
 * Nothing here logs a rule, a rationale or a piece of evidence. Evidence quotes review
 * comments, which can quote repository contents, so it is exactly as sensitive as an
 * agent transcript: rendered, never written to a log.
 */
export function useConventionList(): UseConventionListResult {
  const {
    conventionRules,
    isConventionRulesLoading,
    isConventionRulesFetching,
    conventionRulesError,
    refetchConventionRules,
  } = useQueryConventions();

  const {
    distillConventions,
    isDistillConventionsPending,
    distillConventionsError,
    distilledConventionRules,
  } = useExecuteDistillConventions();

  const { setConventionState, isSetConventionStatePending, setConventionStateError } =
    useExecuteSetConventionState();

  useEffect(() => {
    if (!isDefined(conventionRulesError)) return;
    logError(conventionRulesError, 'useConventionList.conventionRules');
  }, [conventionRulesError]);

  const rules = conventionRules ?? EMPTY_RULES;

  const rulesByCategory = groupBy(rules, (rule) => rule.category);

  const groups = CATEGORY_ORDER.flatMap<ConventionCategoryGroupItem>((category) => {
    const categoryRules = rulesByCategory.get(category);
    if (categoryRules === undefined) return [];

    const presentation = toCategoryPresentation(category);
    const orderedRules = [...categoryRules].sort(
      (first, second) => STATE_ORDER.indexOf(first.state) - STATE_ORDER.indexOf(second.state),
    );

    return [
      {
        id: `${GROUP_ID_PREFIX}${GROUP_ID_SEPARATOR}${category}`,
        heading: presentation.heading,
        explanation: presentation.explanation,
        countLabel: toRuleCountLabel(orderedRules.length),
        rules: orderedRules.map((rule) =>
          toRuleItem({
            rule,
            isPending: isSetConventionStatePending,
            onSetState: setConventionState,
          }),
        ),
      },
    ];
  });

  const statusLabel = (() => {
    if (isConventionRulesLoading) return LOADING_LABEL;
    if (rules.length === EMPTY_COUNT) return EMPTY_LABEL;
    return null;
  })();

  const distillStatusLabel = (() => {
    if (isDistillConventionsPending) return DISTILLING_LABEL;
    if (isDefined(distilledConventionRules)) return DISTILLED_LABEL;
    return null;
  })();

  const conventionRulesErrorMessage = (() => {
    if (!isDefined(conventionRulesError)) return null;
    return isIpcError(conventionRulesError)
      ? conventionRulesError.message
      : CONVENTION_RULES_ERROR_FALLBACK;
  })();

  const distillErrorMessage = (() => {
    if (!isDefined(distillConventionsError)) return null;
    return isIpcError(distillConventionsError)
      ? distillConventionsError.message
      : DISTILL_ERROR_FALLBACK;
  })();

  const setConventionStateErrorMessage = (() => {
    if (!isDefined(setConventionStateError)) return null;
    return isIpcError(setConventionStateError)
      ? setConventionStateError.message
      : SET_STATE_ERROR_FALLBACK;
  })();

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    countLabel: toRuleCountLabel(rules.length),
    rejectionNoticeLabel: REJECTION_NOTICE,
    distillLabel: DISTILL_LABEL,
    distillExplanation: DISTILL_EXPLANATION,
    isDistilling: isDistillConventionsPending,
    distillStatusLabel,
    distillErrorMessage,
    onDistillClick: () => distillConventions(),
    refreshLabel: REFRESH_LABEL,
    // A refresh keeps the corpus on screen; only the very first read has nothing to show.
    isRefreshingConventionRules: isConventionRulesFetching && !isConventionRulesLoading,
    onRefreshClick: refetchConventionRules,
    groups,
    statusLabel,
    conventionRulesErrorMessage,
    setConventionStateErrorMessage,
  };
}
