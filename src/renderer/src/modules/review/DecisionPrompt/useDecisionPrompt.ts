import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import type { AgentDecision } from '@shared/runs';

export interface UseDecisionPromptOptions {
  runId: string;
  decision: AgentDecision;
}

export interface DecisionOptionItem {
  key: string;
  label: string;
  /** The protocol orders options best-first, so only the head is recommended. */
  isRecommended: boolean;
  isSelected: boolean;
  /** Bound here so the option list carries no inline arrow. */
  onSelect: () => void;
}

interface UseDecisionPromptResult {
  question: string;
  contextText: string | null;
  optionItems: DecisionOptionItem[];
  /** False when the agent offered one option or none: there is nothing to choose between. */
  hasChoosableOptions: boolean;
  replyFieldId: string;
  replyLabel: string;
  replyPlaceholder: string;
  replyDraft: string;
  isSendDisabled: boolean;
  /** Non-null while a drafted reply cannot yet be delivered to the agent. */
  replyDeliveryNote: string | null;
  onReplyChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}

const REPLY_FIELD_ID_PREFIX = 'decision-reply-';
const REPLY_LABEL = 'Your answer';
const REPLY_PLACEHOLDER = 'Pick an option above or describe what the agent should do instead.';
const RECOMMENDED_OPTION_INDEX = 0;

/** One option is a statement, not a choice; two is the first point a list earns its space. */
const MIN_CHOOSABLE_OPTION_COUNT = 2;

const EMPTY_LENGTH = 0;
const EMPTY_DRAFT = '';

/**
 * Answering goes back through `agent.send` on the same agent, which is the identical
 * mechanism to a targeted edit and lands with revisions. Until that channel exists the
 * answer can be composed but not delivered, so the control says so instead of failing
 * silently on click.
 */
const REPLY_DELIVERY_NOTE =
  'Answering resumes this same agent, so it keeps everything it already worked out. Delivering the reply arrives with revisions.';

export function useDecisionPrompt({
  runId,
  decision,
}: UseDecisionPromptOptions): UseDecisionPromptResult {
  const [replyDraft, setReplyDraft] = useState(EMPTY_DRAFT);

  const optionItems = useMemo(
    () =>
      decision.options.map((option, index) => ({
        key: String(index),
        label: option,
        isRecommended: index === RECOMMENDED_OPTION_INDEX,
        isSelected: option === replyDraft,
        onSelect: () => setReplyDraft(option),
      })),
    [decision.options, replyDraft],
  );

  const onReplyChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setReplyDraft(event.target.value);
  }, []);

  const replyDeliveryNote: string | null = REPLY_DELIVERY_NOTE;
  const isDraftEmpty = replyDraft.trim().length === EMPTY_LENGTH;

  return {
    question: decision.question,
    contextText: decision.context,
    optionItems,
    hasChoosableOptions: decision.options.length >= MIN_CHOOSABLE_OPTION_COUNT,
    replyFieldId: `${REPLY_FIELD_ID_PREFIX}${runId}`,
    replyLabel: REPLY_LABEL,
    replyPlaceholder: REPLY_PLACEHOLDER,
    replyDraft,
    isSendDisabled: isDraftEmpty || replyDeliveryNote !== null,
    replyDeliveryNote,
    onReplyChange,
  };
}
