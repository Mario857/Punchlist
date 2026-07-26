import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import type { AgentDecision } from '@shared/runs';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useExecuteContinueRun } from '@renderer/modules/runs/useQueryRuns';

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
  replyExplanation: string;
  replyPlaceholder: string;
  replyDraft: string;
  isSendDisabled: boolean;
  isSendPending: boolean;
  /** Non-null only while the reply is with the agent, which can take a while. */
  sendPendingLabel: string | null;
  sendErrorMessage: string | null;
  sendErrorRemediation: string | null;
  onReplyChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSendClick: () => void;
}

const REPLY_FIELD_ID_PREFIX = 'decision-reply-';
const REPLY_LABEL = 'Your answer';

/**
 * Adapted from the note this box used to carry while the reply could be composed but
 * not delivered: the continuity is the point, so it stays as copy now that answering
 * actually resumes the agent.
 */
const REPLY_EXPLANATION =
  'Answering resumes this same agent, so it keeps everything it already worked out.';

const REPLY_PLACEHOLDER = 'Pick an option above or describe what the agent should do instead.';
const RECOMMENDED_OPTION_INDEX = 0;

/** One option is a statement, not a choice; two is the first point a list earns its space. */
const MIN_CHOOSABLE_OPTION_COUNT = 2;

/** Sends are serialized per run in main, so a reply can wait its turn before working. */
const SEND_PENDING_LABEL = 'Sending your answer to the agent…';
const SEND_ERROR_FALLBACK = 'Could not send the answer to the agent.';

const EMPTY_LENGTH = 0;
const EMPTY_DRAFT = '';

export function useDecisionPrompt({
  runId,
  decision,
}: UseDecisionPromptOptions): UseDecisionPromptResult {
  const [replyDraft, setReplyDraft] = useState(EMPTY_DRAFT);
  const { continueRun, isContinueRunPending, continueRunError } = useExecuteContinueRun();

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

  const trimmedReply = replyDraft.trim();
  const isDraftEmpty = trimmedReply.length === EMPTY_LENGTH;

  const onSendClick = useCallback(() => {
    // Main rejects a blank continuation anyway; refusing it here keeps the button from
    // offering a send that cannot land.
    if (trimmedReply.length === EMPTY_LENGTH) return;
    continueRun({ runId, message: trimmedReply });
  }, [continueRun, runId, trimmedReply]);

  const sendErrorMessage = (() => {
    if (!isDefined(continueRunError)) return null;
    return isIpcError(continueRunError) ? continueRunError.message : SEND_ERROR_FALLBACK;
  })();

  return {
    question: decision.question,
    contextText: decision.context,
    optionItems,
    hasChoosableOptions: decision.options.length >= MIN_CHOOSABLE_OPTION_COUNT,
    replyFieldId: `${REPLY_FIELD_ID_PREFIX}${runId}`,
    replyLabel: REPLY_LABEL,
    replyExplanation: REPLY_EXPLANATION,
    replyPlaceholder: REPLY_PLACEHOLDER,
    replyDraft,
    isSendDisabled: isDraftEmpty,
    isSendPending: isContinueRunPending,
    sendPendingLabel: isContinueRunPending ? SEND_PENDING_LABEL : null,
    sendErrorMessage,
    sendErrorRemediation: isIpcError(continueRunError) ? continueRunError.remediation : null,
    onReplyChange,
    onSendClick,
  };
}
