import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { SELECTION_SIDE, type SelectionSide, type TargetedEditSelection } from '@shared/runs';
import { BADGE_TONE, type BadgeTone } from '@renderer/components/Badge';
import { assertNever } from '@renderer/lib/assertNever';

export interface UseInlinePromptOptions {
  runId: string;
  selection: TargetedEditSelection;
  isSendPending: boolean;
  onSend: (message: string) => void;
  onDismiss: () => void;
}

interface UseInlinePromptResult {
  heading: string;
  explanation: string;
  /** Which framing is about to be sent, since the wrong one produces a wrong edit. */
  sideLabel: string;
  sideTone: BadgeTone;
  rangeLabel: string;
  anchorExplanation: string;
  selectionPreview: string;
  promptFieldId: string;
  promptLabel: string;
  promptPlaceholder: string;
  promptRowCount: number;
  promptDraft: string;
  sendLabel: string;
  sendTitle: string;
  isSendDisabled: boolean;
  /** Non-null only while an earlier edit is still with the agent. */
  sendPendingLabel: string | null;
  dismissLabel: string;
  dismissTitle: string;
  onPromptChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendClick: () => void;
  onDismissClick: () => void;
}

const MODIFIED_HEADING = 'Change these lines';
const MODIFIED_EXPLANATION =
  'The selection is part of the patch the agent wrote, so it is asked to rewrite that region and leave the rest of the patch alone.';
const MODIFIED_SIDE_LABEL = 'Modified side · change this';
const MODIFIED_PLACEHOLDER = 'Describe what is wrong with the selected lines.';

const ORIGINAL_HEADING = 'Point the agent at code it left alone';
const ORIGINAL_EXPLANATION =
  'The selection is from the base file, so it is asked to treat these lines as something it missed rather than something it wrote.';
const ORIGINAL_SIDE_LABEL = 'Original side · you missed this';
const ORIGINAL_PLACEHOLDER = 'Describe what the agent should have done here.';

const ANCHOR_EXPLANATION =
  'These lines are sent verbatim as the anchor. The line range is only a hint, because it drifts as soon as anything above it changes.';

const PROMPT_FIELD_ID_PREFIX = 'inline-prompt-';
const PROMPT_LABEL = 'Targeted edit';
const PROMPT_ROW_COUNT = 3;
const SEND_LABEL = 'Send targeted edit';
const SEND_TITLE = 'Send the targeted edit (⌘↵)';
const DISMISS_LABEL = 'Cancel';
const DISMISS_TITLE = 'Close the inline prompt (Esc)';

/** Sends are serialized per run in main, so a second edit waits rather than racing. */
const SEND_PENDING_LABEL = 'An earlier edit is still with the agent, so this one queues behind it.';

const PATH_SEPARATOR = ':';
const RANGE_SEPARATOR = '-';
const SEND_KEY = 'Enter';
const DISMISS_KEY = 'Escape';

const EMPTY_LENGTH = 0;
const EMPTY_DRAFT = '';

interface SideFraming {
  heading: string;
  explanation: string;
  sideLabel: string;
  sideTone: BadgeTone;
  placeholder: string;
}

/**
 * Which side the selection came from changes the instruction, not just the context, so
 * the two framings stay separate rather than collapsing into one prompt.
 */
function toSideFraming(side: SelectionSide): SideFraming {
  switch (side) {
    case SELECTION_SIDE.MODIFIED:
      return {
        heading: MODIFIED_HEADING,
        explanation: MODIFIED_EXPLANATION,
        sideLabel: MODIFIED_SIDE_LABEL,
        sideTone: BADGE_TONE.ACCENT,
        placeholder: MODIFIED_PLACEHOLDER,
      };
    case SELECTION_SIDE.ORIGINAL:
      return {
        heading: ORIGINAL_HEADING,
        explanation: ORIGINAL_EXPLANATION,
        sideLabel: ORIGINAL_SIDE_LABEL,
        sideTone: BADGE_TONE.INFO,
        placeholder: ORIGINAL_PLACEHOLDER,
      };
    default:
      return assertNever(side);
  }
}

export function useInlinePrompt({
  runId,
  selection,
  isSendPending,
  onSend,
  onDismiss,
}: UseInlinePromptOptions): UseInlinePromptResult {
  const [promptDraft, setPromptDraft] = useState(EMPTY_DRAFT);
  const framing = toSideFraming(selection.side);

  const onPromptChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setPromptDraft(event.target.value);
  }, []);

  const trimmedPrompt = promptDraft.trim();
  const isDraftEmpty = trimmedPrompt.length === EMPTY_LENGTH;

  const onSendClick = useCallback(() => {
    // Main rejects a blank continuation anyway; refusing it here keeps the button from
    // offering a send that cannot land.
    if (trimmedPrompt.length === EMPTY_LENGTH) return;
    onSend(trimmedPrompt);
  }, [onSend, trimmedPrompt]);

  const onDismissClick = useCallback(() => onDismiss(), [onDismiss]);

  const onPromptKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === DISMISS_KEY) {
        event.preventDefault();
        onDismiss();
        return;
      }
      // Enter alone belongs to the textarea: a targeted edit is often two sentences.
      if (event.key === SEND_KEY && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSendClick();
      }
    },
    [onDismiss, onSendClick],
  );

  const lineRange = `${selection.startLine}${RANGE_SEPARATOR}${selection.endLine}`;

  return {
    heading: framing.heading,
    explanation: framing.explanation,
    sideLabel: framing.sideLabel,
    sideTone: framing.sideTone,
    rangeLabel: `${selection.path}${PATH_SEPARATOR}${lineRange}`,
    anchorExplanation: ANCHOR_EXPLANATION,
    selectionPreview: selection.content,
    promptFieldId: `${PROMPT_FIELD_ID_PREFIX}${runId}`,
    promptLabel: PROMPT_LABEL,
    promptPlaceholder: framing.placeholder,
    promptRowCount: PROMPT_ROW_COUNT,
    promptDraft,
    sendLabel: SEND_LABEL,
    sendTitle: SEND_TITLE,
    isSendDisabled: isDraftEmpty,
    sendPendingLabel: isSendPending ? SEND_PENDING_LABEL : null,
    dismissLabel: DISMISS_LABEL,
    dismissTitle: DISMISS_TITLE,
    onPromptChange,
    onPromptKeyDown,
    onSendClick,
    onDismissClick,
  };
}
