import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@renderer/lib/queryKeys';
import { logError } from '@renderer/lib/logError';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useQueryCursorKeyStatus } from '@renderer/hooks/useQueryModelCatalog';

const HEADING = 'Cursor API key';
const EXPLANATION =
  'Needed from the moment a run starts. It is encrypted with the OS keychain and used only inside the main process — there is no channel that reads it back, so once it is stored this screen cannot see it either.';
const STORED_LABEL = 'A key is stored.';
const MISSING_LABEL = 'No key is stored yet.';
const FIELD_LABEL = 'Paste a key from cursor.com → Dashboard → API Keys';
const FIELD_PLACEHOLDER = 'crsr_…';
const SAVE_LABEL = 'Store this key';
const REPLACE_LABEL = 'Replace the stored key';
const CLEAR_LABEL = 'Remove the stored key';
const SAVE_ERROR_FALLBACK = 'That key could not be stored.';
const CLEAR_ERROR_FALLBACK = 'The stored key could not be removed.';
const EMPTY_DRAFT = '';
const EMPTY_LENGTH = 0;

interface UseCursorKeyCardResult {
  heading: string;
  explanation: string;
  statusLabel: string;
  isCursorKeySet: boolean;
  fieldLabel: string;
  fieldPlaceholder: string;
  draft: string;
  saveLabel: string;
  clearLabel: string | null;
  isSaveDisabled: boolean;
  isPending: boolean;
  errorMessage: string | null;
  onDraftChange: (draft: string) => void;
  onSaveClick: () => void;
  onClearClick: () => void;
}

/**
 * The one screen that sends a secret to main. It is deliberately one-way: the draft
 * lives here only until it is stored, and nothing ever reads a key back, so the field
 * is always empty rather than pre-filled with something to leak.
 */
export function useCursorKeyCard(): UseCursorKeyCardResult {
  const queryClient = useQueryClient();
  const { isCursorKeySet } = useQueryCursorKeyStatus();
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const settleKeyStatus = (isSet: boolean): void => {
    queryClient.setQueryData(queryKeys.cursorKeyStatus(), isSet);
    // The model catalog is unreadable without a key, so it becomes answerable the
    // moment one is stored and stale the moment one is removed.
    void queryClient.invalidateQueries({ queryKey: queryKeys.modelCatalog() });
  };

  const save = useMutation({
    mutationFn: async (key: string) => unwrapIpcResult(await requireBridge().cursorKey.set(key)),
    onSuccess: (isSet) => {
      // Cleared on success rather than left in the field: the value is stored, and
      // keeping a copy on screen would be the one place it could still be read.
      setDraft(EMPTY_DRAFT);
      settleKeyStatus(isSet);
    },
    // The key itself is never in the error path, so the message is safe to log.
    onError: (error) => logError(error, 'useCursorKeyCard.save'),
  });

  const clear = useMutation({
    mutationFn: async () => unwrapIpcResult(await requireBridge().cursorKey.clear()),
    onSuccess: settleKeyStatus,
    onError: (error) => logError(error, 'useCursorKeyCard.clear'),
  });

  const trimmedDraft = draft.trim();
  const isStored = isCursorKeySet === true;
  const activeError = save.error ?? clear.error;

  const errorMessage = (() => {
    if (activeError === null || activeError === undefined) return null;
    if (isIpcError(activeError)) return activeError.message;
    return save.error === null ? CLEAR_ERROR_FALLBACK : SAVE_ERROR_FALLBACK;
  })();

  return {
    heading: HEADING,
    explanation: EXPLANATION,
    statusLabel: isStored ? STORED_LABEL : MISSING_LABEL,
    isCursorKeySet: isStored,
    fieldLabel: FIELD_LABEL,
    fieldPlaceholder: FIELD_PLACEHOLDER,
    draft,
    saveLabel: isStored ? REPLACE_LABEL : SAVE_LABEL,
    clearLabel: isStored ? CLEAR_LABEL : null,
    isSaveDisabled: trimmedDraft.length === EMPTY_LENGTH || save.isPending,
    isPending: save.isPending || clear.isPending,
    errorMessage,
    onDraftChange: setDraft,
    onSaveClick: () => {
      if (trimmedDraft.length === EMPTY_LENGTH) return;
      save.mutate(trimmedDraft);
    },
    onClearClick: () => clear.mutate(),
  };
}
