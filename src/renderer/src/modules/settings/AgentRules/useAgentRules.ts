import { useState, type ChangeEvent } from 'react';
import { AGENT_RULES_MAX_LENGTH } from '@shared/settings';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { isDefined } from '@renderer/lib/guards';
import {
  useExecuteUpdateSettings,
  useQuerySettings,
} from '@renderer/modules/settings/useQuerySettings';

interface UseAgentRulesResult {
  heading: string;
  explanation: string;
  fieldId: string;
  fieldLabel: string;
  placeholder: string;
  rowCount: number;
  draft: string;
  counterLabel: string;
  saveLabel: string;
  isSaveDisabled: boolean;
  isSavePending: boolean;
  savedLabel: string | null;
  errorMessage: string | null;
  onDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSaveClick: () => void;
}

const HEADING = 'Rules for every agent';
const EXPLANATION =
  'Handed to every agent that resolves a comment, and to every second reader, on top of whatever CLAUDE.md, AGENTS.md and .cursor/rules already say in the repository being worked on. Write them the way you would tell a new colleague: prose, not configuration. Where a rule here conflicts with the repository’s own, the agent is told to follow the repository and say so.';
const FIELD_ID = 'settings-agent-rules';
const FIELD_LABEL = 'House rules';
const PLACEHOLDER =
  'e.g. Prefer named exports. Never widen a public type to fix a call site. Match the file’s existing test style rather than introducing a new one.';
const ROW_COUNT = 10;
const SAVE_LABEL = 'Save rules';
const SAVED_LABEL = 'Saved. Every run started from now on carries these.';
const SAVE_ERROR_FALLBACK = 'Those rules could not be saved.';
const COUNTER_SEPARATOR = ' / ';
const COUNTER_SUFFIX = ' characters';

/**
 * A draft that only reaches the store on Save. Rules ride in every prompt, so saving
 * per keystroke would rewrite the settings file — and change what a run in flight was
 * started with — while someone is still mid-sentence.
 */
export function useAgentRules(): UseAgentRulesResult {
  const { settings } = useQuerySettings();
  const { updateSettings, isUpdateSettingsPending, updateSettingsError } =
    useExecuteUpdateSettings();

  const storedRules = settings?.agentRules ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? storedRules;
  const isDirty = value !== storedRules;

  const errorMessage = (() => {
    if (!isDefined(updateSettingsError)) return null;
    return isIpcError(updateSettingsError) ? updateSettingsError.message : SAVE_ERROR_FALLBACK;
  })();

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    fieldId: FIELD_ID,
    fieldLabel: FIELD_LABEL,
    placeholder: PLACEHOLDER,
    rowCount: ROW_COUNT,
    draft: value,
    counterLabel: `${value.length}${COUNTER_SEPARATOR}${AGENT_RULES_MAX_LENGTH}${COUNTER_SUFFIX}`,
    saveLabel: SAVE_LABEL,
    isSaveDisabled: !isDirty || value.length > AGENT_RULES_MAX_LENGTH,
    isSavePending: isUpdateSettingsPending,
    // Only once what is on screen is what is stored, so it cannot claim a stale save.
    savedLabel: !isDirty && storedRules.length > 0 ? SAVED_LABEL : null,
    errorMessage,
    onDraftChange: (event) => setDraft(event.target.value),
    onSaveClick: () => {
      updateSettings({ agentRules: value });
      setDraft(null);
    },
  };
}
