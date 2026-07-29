import { useCallback, useState, type ChangeEvent } from 'react';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useExecuteContinueRun } from '@renderer/modules/runs/useQueryRuns';

export interface UseFollowUpPromptOptions {
  runId: string;
}

interface UseFollowUpPromptResult {
  heading: string;
  explanation: string;
  promptFieldId: string;
  promptLabel: string;
  promptPlaceholder: string;
  promptRowCount: number;
  promptDraft: string;
  sendLabel: string;
  isSendDisabled: boolean;
  isSendPending: boolean;
  /** Non-null only while the follow-up is with the agent, which can take a while. */
  sendPendingLabel: string | null;
  sendErrorMessage: string | null;
  sendErrorRemediation: string | null;
  onPromptChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSendClick: () => void;
}

const HEADING = 'Ask for a change to this patch';
const EXPLANATION =
  'This goes to the same agent that wrote the patch, so it still knows the comment, the code, and what it tried. The result arrives as another revision on top of what is on screen.';

const PROMPT_FIELD_ID_PREFIX = 'follow-up-prompt-';
const PROMPT_LABEL = 'Follow-up';
const PROMPT_PLACEHOLDER = 'Describe what is wrong with the patch as a whole.';
const PROMPT_ROW_COUNT = 3;
const SEND_LABEL = 'Send follow-up';

/** Sends are serialized per run in main, so a follow-up can wait its turn before working. */
const SEND_PENDING_LABEL = 'Sending your follow-up to the agent…';
const SEND_ERROR_FALLBACK = 'Could not send the follow-up to the agent.';

const EMPTY_LENGTH = 0;
const EMPTY_DRAFT = '';

/**
 * The whole-patch follow-up is the second of the three revision entry points and shares
 * the decision reply's mechanism exactly: one `agent.send` on the same agent, with main
 * deciding from the run's state that this one means "revise", not "answer".
 */
export function useFollowUpPrompt({ runId }: UseFollowUpPromptOptions): UseFollowUpPromptResult {
  const [promptDraft, setPromptDraft] = useState(EMPTY_DRAFT);

  // The pane is deliberately never remounted between runs — a keyed remount made
  // React delete these subtrees one sibling at a time, and a cleanup that throws
  // mid-deletion strands the rest in the DOM, which is how the decision row came to
  // appear once per comment visited. Per-run state resets here instead.
  const [previousRunId, setPreviousRunId] = useState(runId);
  if (previousRunId !== runId) {
    setPreviousRunId(runId);
    setPromptDraft(EMPTY_DRAFT);
  }
  const { continueRun, isContinueRunPending, continueRunError } = useExecuteContinueRun();

  const onPromptChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setPromptDraft(event.target.value);
  }, []);

  const trimmedPrompt = promptDraft.trim();

  const onSendClick = useCallback(() => {
    // Main rejects a blank continuation anyway; refusing it here keeps the button from
    // offering a send that cannot land.
    if (trimmedPrompt.length === EMPTY_LENGTH) return;
    continueRun({ runId, message: trimmedPrompt });
  }, [continueRun, runId, trimmedPrompt]);

  const sendErrorMessage = (() => {
    if (!isDefined(continueRunError)) return null;
    return isIpcError(continueRunError) ? continueRunError.message : SEND_ERROR_FALLBACK;
  })();

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    promptFieldId: `${PROMPT_FIELD_ID_PREFIX}${runId}`,
    promptLabel: PROMPT_LABEL,
    promptPlaceholder: PROMPT_PLACEHOLDER,
    promptRowCount: PROMPT_ROW_COUNT,
    promptDraft,
    sendLabel: SEND_LABEL,
    isSendDisabled: trimmedPrompt.length === EMPTY_LENGTH,
    isSendPending: isContinueRunPending,
    sendPendingLabel: isContinueRunPending ? SEND_PENDING_LABEL : null,
    sendErrorMessage,
    sendErrorRemediation: isIpcError(continueRunError) ? continueRunError.remediation : null,
    onPromptChange,
    onSendClick,
  };
}
