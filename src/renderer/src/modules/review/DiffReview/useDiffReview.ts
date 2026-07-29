import { useCallback, useEffect, useRef, useState } from 'react';
import { loader, type DiffOnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// The worker specifier goes through monaco's exports map, where `./*` maps to
// `./esm/vs/*.js` — the older `monaco-editor/esm/vs/...` path no longer resolves.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import {
  SELECTION_SIDE,
  type CandidatePatchFile,
  type SelectionSide,
  type TargetedEditSelection,
  type WriteRunFileRequest,
} from '@shared/runs';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import {
  useExecuteContinueRun,
  useExecuteWriteRunFile,
  useQueryCandidatePatch,
} from '@renderer/modules/runs/useQueryRuns';
import { useRun } from '@renderer/stores/runStore';

/**
 * `@monaco-editor/react` fetches monaco from a CDN by default, which the app's CSP
 * (`script-src 'self'`) blocks outright, so it is pointed at the bundled copy instead.
 * The worker is wired explicitly for the same reason — monaco computes a diff inside
 * one, and `worker-src 'self' blob:` is what makes the bundled worker loadable.
 */
globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export interface UseDiffReviewOptions {
  runId: string;
  revisionProgressLabel?: string | null;
  /**
   * `ready` only. Hand edits and targeted edits are the same affordance from two
   * directions, and both need the run to still be a candidate nobody else holds.
   */
  isEditable: boolean;
}

interface UseDiffReviewResult {
  isCandidatePatchLoading: boolean;
  candidatePatchErrorMessage: string | null;
  files: readonly CandidatePatchFile[];
  hasFiles: boolean;
  isEmptyPatch: boolean;
  emptyPatchHeading: string;
  emptyPatchExplanation: string;
  selectedPath: string | null;
  selectedPathLabel: string;
  originalContent: string;
  modifiedContent: string;
  language: string;
  /** True while the agent amends the patch, so the diff stays readable but recedes. */
  isDimmed: boolean;
  progressLabel: string | null;
  editorOptions: monaco.editor.IDiffEditorConstructionOptions;
  editorTheme: string;
  editorHeight: string;
  onEditorMount: DiffOnMount;
  previousHunkLabel: string;
  previousHunkTitle: string;
  nextHunkLabel: string;
  nextHunkTitle: string;
  isHunkNavigationDisabled: boolean;
  onPreviousHunkClick: () => void;
  onNextHunkClick: () => void;
  /** Targeted edits are offered exactly where the patch is still editable. */
  isReviseSelectionAvailable: boolean;
  reviseSelectionLabel: string;
  reviseSelectionTitle: string;
  isReviseSelectionDisabled: boolean;
  onReviseSelectionClick: () => void;
  /** Non-null while the inline prompt is open, frozen at the moment it opened. */
  inlinePromptSelection: TargetedEditSelection | null;
  /** Remounts the prompt on a different selection, so no draft follows the cursor. */
  inlinePromptKey: string;
  isTargetedEditPending: boolean;
  onInlinePromptSend: (message: string) => void;
  onInlinePromptDismiss: () => void;
  /** A failed write-back or a rejected targeted edit; never the edit itself. */
  editErrorMessage: string | null;
  editErrorRemediation: string | null;
  onSelectPath: (path: string) => void;
}

const EXTENSION_SEPARATOR = '.';
const DEFAULT_LANGUAGE = 'plaintext';
const NO_REVISIONS = 0;
const EMPTY_CONTENT = '';
const EMPTY_LENGTH = 0;

/** A stable identity, so an absent patch does not rebuild the file tree every render. */
const EMPTY_FILES: readonly CandidatePatchFile[] = [];

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  graphql: 'graphql',
};

const MONACO_THEME = 'vs-dark';
/**
 * A fixed viewport the diff scrolls inside, exactly like the landing preview's
 * combined diff and like an editor pane in Cursor. Content-sizing the editor was
 * tried twice and both times found a way to run away — Monaco's measurements react
 * to the layout they feed — so the editor owns its scrolling and the height is a
 * constant that cannot loop.
 */
const DIFF_EDITOR_HEIGHT = '40rem';
const MONACO_FONT_SIZE = 12;
const MONACO_LINE_HEIGHT = 18;
/** Editor pixels, not pane pixels: the changed-files tree is already subtracted. */
const SIDE_BY_SIDE_MIN_WIDTH = 620;

/**
 * The candidate patch is read from git, never from an editor buffer, so the base side
 * is a viewer in every state: `originalEditable` stays off explicitly rather than by
 * default, since the base commit is not something a review may rewrite.
 */
const READ_ONLY_DIFF_EDITOR_OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  // Two columns need real width. Below this the editor folds to the inline view on its
  // own, which is the difference between reading a patch and reading two gutters.
  useInlineViewWhenSpaceIsLimited: true,
  renderSideBySideInlineBreakpoint: SIDE_BY_SIDE_MIN_WIDTH,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderOverviewRuler: false,
  fontSize: MONACO_FONT_SIZE,
  lineHeight: MONACO_LINE_HEIGHT,
  // With the editor content-sized this is what lets the wheel reach the column around
  // it; when a capped editor does scroll internally, the edges still bubble out.
  scrollbar: { alwaysConsumeMouseWheel: false },
};

/**
 * The modified side accepts typing in `ready`, which is the fast path for "the agent
 * was 95% right but named the variable badly". Two frozen option objects rather than
 * one built per render: the editor re-applies its options whenever their identity
 * changes, so an inline literal would reconfigure monaco on every keystroke.
 */
const EDITABLE_DIFF_EDITOR_OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
  ...READ_ONLY_DIFF_EDITOR_OPTIONS,
  readOnly: false,
};

/**
 * Long enough that a burst of typing is one write and one re-diff, short enough that
 * the patch on disk is never far behind what is on screen.
 */
const HAND_EDIT_WRITE_DEBOUNCE_MS = 500;

const FIRST_COLUMN = 1;
const ONE_LINE = 1;

const DIFF_TARGET = {
  NEXT: 'next',
  PREVIOUS: 'previous',
} as const;

/** Cmd+K deliberately matches Cursor's: this is the same interaction, so it is the same key. */
const INLINE_PROMPT_KEYBINDING = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK;
const NEXT_HUNK_KEYBINDING = monaco.KeyCode.BracketRight;
const PREVIOUS_HUNK_KEYBINDING = monaco.KeyCode.BracketLeft;

const INLINE_PROMPT_ACTION_ID = 'punchlist.reviseSelection';
const INLINE_PROMPT_ACTION_LABEL = 'Revise the selected lines with the agent';
const NEXT_HUNK_ACTION_ID = 'punchlist.nextHunk';
const NEXT_HUNK_ACTION_LABEL = 'Go to the next changed hunk';
const PREVIOUS_HUNK_ACTION_ID = 'punchlist.previousHunk';
const PREVIOUS_HUNK_ACTION_LABEL = 'Go to the previous changed hunk';

/**
 * `]` and `[` are bare keys, so they may only claim a keystroke where typing is not
 * possible. Monaco's own read-only context key is what keeps a bracket typeable on an
 * editable modified side while the always-read-only base side still navigates hunks;
 * the toolbar buttons are the path that works in every state.
 */
const EDITOR_READ_ONLY_CONTEXT = 'editorReadonly';

const LOADING_PATH_LABEL = 'Loading the candidate patch…';
const NO_FILE_PATH_LABEL = 'No file selected';
const PATCH_ERROR_FALLBACK = 'Could not read the candidate patch from the worktree.';
const EMPTY_PATCH_HEADING = 'This run produced no changes';
const EMPTY_PATCH_EXPLANATION =
  'The agent finished without touching any file. That is a real outcome, not a failure: the comment may already be satisfied by the code as it stands.';

const NEXT_HUNK_LABEL = 'Next hunk';
const NEXT_HUNK_TITLE = 'Next hunk (])';
const PREVIOUS_HUNK_LABEL = 'Previous hunk';
const PREVIOUS_HUNK_TITLE = 'Previous hunk ([)';
const REVISE_SELECTION_LABEL = 'Revise selection';
const REVISE_SELECTION_TITLE = 'Revise the selected lines (⌘K)';
const NO_SELECTION_TITLE = 'Select lines on either side of the diff first (⌘K)';

/** Sends are serialized per run in main, so an edit can sit queued before it works. */
const TARGETED_EDIT_PENDING_LABEL = 'Waiting for the agent to take this edit…';
const TARGETED_EDIT_ERROR_FALLBACK = 'Could not send the selection to the agent.';
const HAND_EDIT_ERROR_FALLBACK = 'Could not write your edit into the worktree.';

const SELECTION_KEY_SEPARATOR = ':';
const SELECTION_RANGE_SEPARATOR = '-';

interface EditError {
  message: string;
  remediation: string | null;
}

function toEditError(error: unknown, fallback: string): EditError | null {
  if (!isDefined(error)) return null;
  if (isIpcError(error)) return { message: error.message, remediation: error.remediation };
  return { message: fallback, remediation: null };
}

function languageOf(path: string): string {
  const extension = path.split(EXTENSION_SEPARATOR).at(-1);
  if (extension === undefined) return DEFAULT_LANGUAGE;
  return LANGUAGE_BY_EXTENSION[extension.toLowerCase()] ?? DEFAULT_LANGUAGE;
}

/**
 * Whole lines only: half a line is not something an agent can locate in a file. The
 * content travels verbatim because it is the anchor — the range is a hint, since line
 * numbers drift the moment anything above them is edited.
 */
function readSelection(
  editor: monaco.editor.ICodeEditor,
  side: SelectionSide,
  path: string,
): TargetedEditSelection | null {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (model === null || selection === null || selection.isEmpty()) return null;

  // A drag that stops at the head of a line has not selected that line.
  const isLastLineUntouched =
    selection.endColumn === FIRST_COLUMN && selection.endLineNumber > selection.startLineNumber;
  const endLine = isLastLineUntouched
    ? selection.endLineNumber - ONE_LINE
    : selection.endLineNumber;

  const lineRange = new monaco.Range(
    selection.startLineNumber,
    FIRST_COLUMN,
    endLine,
    model.getLineMaxColumn(endLine),
  );

  return {
    path,
    startLine: selection.startLineNumber,
    endLine,
    content: model.getValueInRange(lineRange),
    side,
  };
}

function toSelectionKey(selection: TargetedEditSelection | null): string {
  if (selection === null) return EMPTY_CONTENT;
  const range = `${selection.startLine}${SELECTION_RANGE_SEPARATOR}${selection.endLine}`;
  return [selection.path, range, selection.side].join(SELECTION_KEY_SEPARATOR);
}

export function useDiffReview({
  runId,
  revisionProgressLabel = null,
  isEditable,
}: UseDiffReviewOptions): UseDiffReviewResult {
  const run = useRun(runId);
  const [requestedPath, setRequestedPath] = useState<string | null>(null);
  const [diffEditor, setDiffEditor] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [liveSelection, setLiveSelection] = useState<TargetedEditSelection | null>(null);
  const [promptSelection, setPromptSelection] = useState<TargetedEditSelection | null>(null);
  const writeDebounceHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWriteRef = useRef<WriteRunFileRequest | null>(null);
  const fetchedContentRef = useRef<string>(EMPTY_CONTENT);

  // Every revision is its own commit in the worktree, so the counter is exactly when
  // the patch on disk stopped matching the one already fetched.
  const revisionCount = isDefined(run) ? run.revisionCount : NO_REVISIONS;
  const { candidatePatch, isCandidatePatchLoading, candidatePatchError } = useQueryCandidatePatch(
    runId,
    revisionCount,
  );
  const { writeRunFile, writeRunFileError } = useExecuteWriteRunFile();
  const { continueRun, isContinueRunPending, continueRunError } = useExecuteContinueRun();

  const files = isDefined(candidatePatch) ? candidatePatch.files : EMPTY_FILES;
  const hasFiles = files.length > EMPTY_LENGTH;

  // A path the user picked survives a refetch, but a revision can delete the file it
  // pointed at, so the first file is the fallback rather than an empty editor.
  const selectedFile = (() => {
    const requested = files.find((file) => file.path === requestedPath);
    if (requested !== undefined) return requested;
    return files.at(0);
  })();

  const selectedPath = isDefined(selectedFile) ? selectedFile.path : null;
  const originalContent = isDefined(selectedFile) ? selectedFile.originalContent : EMPTY_CONTENT;
  const modifiedContent = isDefined(selectedFile) ? selectedFile.modifiedContent : EMPTY_CONTENT;

  const selectedPathLabel = (() => {
    if (isDefined(selectedFile)) return selectedFile.path;
    if (isCandidatePatchLoading) return LOADING_PATH_LABEL;
    return NO_FILE_PATH_LABEL;
  })();

  // The write-back listener has to survive a refetch, so what git last returned is read
  // from a ref instead of from the listener's closure.
  useEffect(() => {
    fetchedContentRef.current = modifiedContent;
  }, [modifiedContent]);

  const onEditorMount = useCallback<DiffOnMount>((editor) => setDiffEditor(editor), []);

  useEffect(() => {
    if (diffEditor === null || !isEditable || selectedPath === null) return undefined;

    const modifiedEditor = diffEditor.getModifiedEditor();

    const flushPendingWrite = (): void => {
      const pending = pendingWriteRef.current;
      pendingWriteRef.current = null;
      // A refetched patch is applied into this same buffer, so the echo of a write
      // arrives as a content change too; writing it back would commit nothing.
      if (pending === null || pending.content === fetchedContentRef.current) return;
      writeRunFile(pending);
    };

    const subscription = modifiedEditor.onDidChangeModelContent(() => {
      pendingWriteRef.current = { runId, path: selectedPath, content: modifiedEditor.getValue() };
      if (writeDebounceHandleRef.current !== null) clearTimeout(writeDebounceHandleRef.current);
      writeDebounceHandleRef.current = setTimeout(flushPendingWrite, HAND_EDIT_WRITE_DEBOUNCE_MS);
    });

    return () => {
      subscription.dispose();
      if (writeDebounceHandleRef.current !== null) clearTimeout(writeDebounceHandleRef.current);
      writeDebounceHandleRef.current = null;
      // An edit typed inside the debounce window is unlanded work: switching file or
      // leaving `ready` must not be what silently discards it.
      flushPendingWrite();
    };
  }, [diffEditor, isEditable, selectedPath, runId, writeRunFile]);

  useEffect(() => {
    if (diffEditor === null || selectedPath === null) return undefined;

    const originalEditor = diffEditor.getOriginalEditor();
    const modifiedEditor = diffEditor.getModifiedEditor();

    // The pane the selection came from is the instruction: modified means "change this
    // code you wrote", original means "you missed this". The editor knows which one
    // fired, so the side is captured rather than guessed later.
    const subscriptions = [
      originalEditor.onDidChangeCursorSelection(() => {
        setLiveSelection(readSelection(originalEditor, SELECTION_SIDE.ORIGINAL, selectedPath));
      }),
      modifiedEditor.onDidChangeCursorSelection(() => {
        setLiveSelection(readSelection(modifiedEditor, SELECTION_SIDE.MODIFIED, selectedPath));
      }),
    ];

    return () => subscriptions.forEach((subscription) => subscription.dispose());
  }, [diffEditor, selectedPath]);

  const onNextHunkClick = useCallback(() => {
    if (diffEditor === null) return;
    diffEditor.goToDiff(DIFF_TARGET.NEXT);
  }, [diffEditor]);

  const onPreviousHunkClick = useCallback(() => {
    if (diffEditor === null) return;
    diffEditor.goToDiff(DIFF_TARGET.PREVIOUS);
  }, [diffEditor]);

  useEffect(() => {
    if (diffEditor === null) return undefined;

    const originalEditor = diffEditor.getOriginalEditor();
    const modifiedEditor = diffEditor.getModifiedEditor();

    // Defined here rather than hoisted into a useCallback: the actions below are the
    // only caller, and a memoized closure the React compiler cannot preserve is worse
    // than no memoization at all.
    const openInlinePrompt = (editor: monaco.editor.ICodeEditor, side: SelectionSide) => {
      if (selectedPath === null) return;
      const captured = readSelection(editor, side, selectedPath);
      if (captured === null) return;
      setPromptSelection(captured);
    };

    // addAction rather than addCommand: only the former hands back a disposable, and
    // these are re-registered whenever the open file changes. It also puts both
    // shortcuts in the command palette, where a keybinding can be discovered.
    const disposables = [
      originalEditor.addAction({
        id: INLINE_PROMPT_ACTION_ID,
        label: INLINE_PROMPT_ACTION_LABEL,
        keybindings: [INLINE_PROMPT_KEYBINDING],
        run: () => openInlinePrompt(originalEditor, SELECTION_SIDE.ORIGINAL),
      }),
      modifiedEditor.addAction({
        id: INLINE_PROMPT_ACTION_ID,
        label: INLINE_PROMPT_ACTION_LABEL,
        keybindings: [INLINE_PROMPT_KEYBINDING],
        run: () => openInlinePrompt(modifiedEditor, SELECTION_SIDE.MODIFIED),
      }),
      originalEditor.addAction({
        id: NEXT_HUNK_ACTION_ID,
        label: NEXT_HUNK_ACTION_LABEL,
        keybindings: [NEXT_HUNK_KEYBINDING],
        keybindingContext: EDITOR_READ_ONLY_CONTEXT,
        run: onNextHunkClick,
      }),
      modifiedEditor.addAction({
        id: NEXT_HUNK_ACTION_ID,
        label: NEXT_HUNK_ACTION_LABEL,
        keybindings: [NEXT_HUNK_KEYBINDING],
        keybindingContext: EDITOR_READ_ONLY_CONTEXT,
        run: onNextHunkClick,
      }),
      originalEditor.addAction({
        id: PREVIOUS_HUNK_ACTION_ID,
        label: PREVIOUS_HUNK_ACTION_LABEL,
        keybindings: [PREVIOUS_HUNK_KEYBINDING],
        keybindingContext: EDITOR_READ_ONLY_CONTEXT,
        run: onPreviousHunkClick,
      }),
      modifiedEditor.addAction({
        id: PREVIOUS_HUNK_ACTION_ID,
        label: PREVIOUS_HUNK_ACTION_LABEL,
        keybindings: [PREVIOUS_HUNK_KEYBINDING],
        keybindingContext: EDITOR_READ_ONLY_CONTEXT,
        run: onPreviousHunkClick,
      }),
    ];

    return () => disposables.forEach((disposable) => disposable.dispose());
  }, [diffEditor, selectedPath, onNextHunkClick, onPreviousHunkClick]);

  // A selection is only offerable while it still points at the open file; switching
  // file leaves the last one stale rather than resetting state from an effect.
  const activeSelection =
    isDefined(liveSelection) && liveSelection.path === selectedPath ? liveSelection : null;

  const onReviseSelectionClick = useCallback(() => {
    if (activeSelection === null) return;
    setPromptSelection(activeSelection);
  }, [activeSelection]);

  const onInlinePromptSend = useCallback(
    (message: string) => {
      if (promptSelection === null) return;
      continueRun({ runId, message, selection: promptSelection });
      // The run becomes `revising` from here and the dimmed diff carries the progress,
      // so the prompt closes rather than growing a second indicator beside it.
      setPromptSelection(null);
    },
    [continueRun, promptSelection, runId],
  );

  const onInlinePromptDismiss = useCallback(() => setPromptSelection(null), []);

  const onSelectPath = useCallback((path: string) => setRequestedPath(path), []);

  const progressLabel = (() => {
    if (isDefined(revisionProgressLabel)) return revisionProgressLabel;
    // Sends are serialized per run in main, so a targeted edit can sit queued before
    // the run flips to revising. That wait is shown rather than looking dropped.
    if (isContinueRunPending) return TARGETED_EDIT_PENDING_LABEL;
    return null;
  })();

  const editError =
    toEditError(writeRunFileError, HAND_EDIT_ERROR_FALLBACK) ??
    toEditError(continueRunError, TARGETED_EDIT_ERROR_FALLBACK);

  return {
    isCandidatePatchLoading,
    candidatePatchErrorMessage: (() => {
      if (!isDefined(candidatePatchError)) return null;
      return isIpcError(candidatePatchError) ? candidatePatchError.message : PATCH_ERROR_FALLBACK;
    })(),
    files,
    hasFiles,
    // An absent patch while loading is not the empty outcome; only a fetched one is.
    isEmptyPatch: isDefined(candidatePatch) && !hasFiles,
    emptyPatchHeading: EMPTY_PATCH_HEADING,
    emptyPatchExplanation: EMPTY_PATCH_EXPLANATION,
    selectedPath,
    selectedPathLabel,
    originalContent,
    modifiedContent,
    language: isDefined(selectedFile) ? languageOf(selectedFile.path) : DEFAULT_LANGUAGE,
    isDimmed: progressLabel !== null,
    progressLabel,
    editorOptions: isEditable ? EDITABLE_DIFF_EDITOR_OPTIONS : READ_ONLY_DIFF_EDITOR_OPTIONS,
    editorTheme: MONACO_THEME,
    editorHeight: DIFF_EDITOR_HEIGHT,
    onEditorMount,
    previousHunkLabel: PREVIOUS_HUNK_LABEL,
    previousHunkTitle: PREVIOUS_HUNK_TITLE,
    nextHunkLabel: NEXT_HUNK_LABEL,
    nextHunkTitle: NEXT_HUNK_TITLE,
    isHunkNavigationDisabled: diffEditor === null || !hasFiles,
    onPreviousHunkClick,
    onNextHunkClick,
    isReviseSelectionAvailable: isEditable,
    reviseSelectionLabel: REVISE_SELECTION_LABEL,
    reviseSelectionTitle: activeSelection === null ? NO_SELECTION_TITLE : REVISE_SELECTION_TITLE,
    isReviseSelectionDisabled: activeSelection === null,
    onReviseSelectionClick,
    // Leaving `ready` closes the prompt too: the agent holds the run at that point.
    inlinePromptSelection: isEditable ? promptSelection : null,
    inlinePromptKey: toSelectionKey(promptSelection),
    isTargetedEditPending: isContinueRunPending,
    onInlinePromptSend,
    onInlinePromptDismiss,
    editErrorMessage: isDefined(editError) ? editError.message : null,
    editErrorRemediation: isDefined(editError) ? editError.remediation : null,
    onSelectPath,
  };
}
