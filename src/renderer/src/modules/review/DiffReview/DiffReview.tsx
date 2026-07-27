import { DiffEditor } from '@monaco-editor/react';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { joinClassNames } from '@renderer/lib/classNames';
import { ChangedFilesTree } from '@renderer/modules/review/DiffReview/components/ChangedFilesTree/ChangedFilesTree';
import { useDiffReview } from '@renderer/modules/review/DiffReview/useDiffReview';
import { InlinePrompt } from '@renderer/modules/review/InlinePrompt/InlinePrompt';

export interface DiffReviewProps {
  runId: string;
  /**
   * Set while the agent amends the patch. The diff stays on screen dimmed with this
   * inline: swapping to a transcript would throw away the context being read.
   */
  revisionProgressLabel?: string | null;
  /**
   * `ready` only: the modified side accepts typing and a selection can be handed to the
   * agent. Every other state keeps the patch a viewer.
   */
  isEditable: boolean;
}

const SECTION_LABEL = 'Candidate patch';
const EDITOR_LOADING_LABEL = 'Loading the diff';
/**
 * Pinned while the tall diff scrolls past, because switching file or hunk is something
 * you decide mid-read — sending you back to the top to do it would undo the point of
 * the single scroll column. The tree pins below the toolbar's row, and caps its own
 * height so a long file list scrolls within itself rather than growing past the
 * viewport it is pinned inside.
 */
const FILE_TREE_CLASS =
  'border-border sticky top-10 max-h-screen w-56 shrink-0 self-start overflow-y-auto border-r pr-1';
/** Above the sticky tree, and backed so the diff does not read through it. */
const HEADER_CLASS = 'bg-bg-1/90 sticky top-0 z-10 flex items-center gap-2 py-1 backdrop-blur';
const HEADER_PATH_CLASS = 'text-ink min-w-0 flex-1 truncate font-mono text-xs';
const PROGRESS_CLASS = 'text-state-revising flex items-center gap-1.5 text-xs';
const TOOLBAR_CLASS = 'flex shrink-0 items-center gap-1';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const REMEDIATION_CLASS = 'text-muted block';
// No flex sizing: the editor reports its content height and the row wraps it, so the
// review column around it is the one thing that scrolls.
const DIFF_BODY_CLASS = 'flex';
const LOADING_BODY_CLASS = 'grid h-40 place-items-center';
const DIMMED_CLASS = 'opacity-50';

export function DiffReview({ runId, revisionProgressLabel, isEditable }: DiffReviewProps) {
  const {
    isCandidatePatchLoading,
    candidatePatchErrorMessage,
    files,
    hasFiles,
    isEmptyPatch,
    emptyPatchHeading,
    emptyPatchExplanation,
    selectedPath,
    selectedPathLabel,
    originalContent,
    modifiedContent,
    language,
    isDimmed,
    progressLabel,
    editorOptions,
    editorTheme,
    editorHeight,
    onEditorMount,
    previousHunkLabel,
    previousHunkTitle,
    nextHunkLabel,
    nextHunkTitle,
    isHunkNavigationDisabled,
    onPreviousHunkClick,
    onNextHunkClick,
    isReviseSelectionAvailable,
    reviseSelectionLabel,
    reviseSelectionTitle,
    isReviseSelectionDisabled,
    onReviseSelectionClick,
    inlinePromptSelection,
    inlinePromptKey,
    isTargetedEditPending,
    onInlinePromptSend,
    onInlinePromptDismiss,
    editErrorMessage,
    editErrorRemediation,
    onSelectPath,
  } = useDiffReview({ runId, revisionProgressLabel, isEditable });

  const progress =
    progressLabel === null ? null : (
      <p role="status" className={PROGRESS_CLASS}>
        <Spinner size={SPINNER_SIZE.SM} label={progressLabel} />
        {progressLabel}
      </p>
    );

  // The visible equivalent of ⌘K, so the shortcut stays an accelerator rather than the
  // only way to reach a targeted edit.
  const reviseSelectionButton = isReviseSelectionAvailable ? (
    <Button
      variant={BUTTON_VARIANT.SECONDARY}
      size={BUTTON_SIZE.SM}
      isDisabled={isReviseSelectionDisabled}
      title={reviseSelectionTitle}
      onClick={onReviseSelectionClick}
    >
      {reviseSelectionLabel}
    </Button>
  ) : null;

  // The changed-files tree moves between files; these move within one.
  const toolbar = hasFiles ? (
    <div className={TOOLBAR_CLASS}>
      <Button
        variant={BUTTON_VARIANT.GHOST}
        size={BUTTON_SIZE.SM}
        isDisabled={isHunkNavigationDisabled}
        title={previousHunkTitle}
        onClick={onPreviousHunkClick}
      >
        {previousHunkLabel}
      </Button>
      <Button
        variant={BUTTON_VARIANT.GHOST}
        size={BUTTON_SIZE.SM}
        isDisabled={isHunkNavigationDisabled}
        title={nextHunkTitle}
        onClick={onNextHunkClick}
      >
        {nextHunkLabel}
      </Button>
      {reviseSelectionButton}
    </div>
  ) : null;

  const editErrorRemediationLine =
    editErrorRemediation === null ? null : (
      <span className={REMEDIATION_CLASS}>{editErrorRemediation}</span>
    );

  // A rejected write or a refused send has to be visible after the prompt has closed,
  // so it is reported beside the patch rather than inside the surface that sent it.
  const editError =
    editErrorMessage === null ? null : (
      <p role="alert" className={ERROR_CLASS}>
        {editErrorMessage}
        {editErrorRemediationLine}
      </p>
    );

  const inlinePrompt =
    inlinePromptSelection === null ? null : (
      <InlinePrompt
        key={inlinePromptKey}
        runId={runId}
        selection={inlinePromptSelection}
        isSendPending={isTargetedEditPending}
        onSend={onInlinePromptSend}
        onDismiss={onInlinePromptDismiss}
      />
    );

  const diffBodyClassName = isDimmed
    ? joinClassNames(DIFF_BODY_CLASS, DIMMED_CLASS)
    : DIFF_BODY_CLASS;

  const body = (() => {
    if (isCandidatePatchLoading) {
      return (
        <div className={LOADING_BODY_CLASS}>
          <Spinner size={SPINNER_SIZE.MD} label={EDITOR_LOADING_LABEL} />
        </div>
      );
    }

    if (candidatePatchErrorMessage !== null) {
      return (
        <p role="alert" className="text-danger flex-1 text-sm leading-relaxed">
          {candidatePatchErrorMessage}
        </p>
      );
    }

    if (isEmptyPatch) {
      return (
        <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD}>
          <h3 className="text-ink text-sm font-semibold">{emptyPatchHeading}</h3>
          <p className="text-muted mt-1 text-xs leading-relaxed">{emptyPatchExplanation}</p>
        </Card>
      );
    }

    if (!hasFiles) return null;

    return (
      <div className={diffBodyClassName}>
        <div className={FILE_TREE_CLASS}>
          <ChangedFilesTree files={files} selectedPath={selectedPath} onSelectPath={onSelectPath} />
        </div>
        <div className="min-w-0 flex-1">
          <DiffEditor
            original={originalContent}
            modified={modifiedContent}
            language={language}
            theme={editorTheme}
            height={editorHeight}
            options={editorOptions}
            onMount={onEditorMount}
            loading={<Spinner size={SPINNER_SIZE.MD} label={EDITOR_LOADING_LABEL} />}
          />
        </div>
      </div>
    );
  })();

  return (
    <section aria-label={SECTION_LABEL} className="flex min-h-0 flex-1 flex-col gap-2">
      <header className={HEADER_CLASS}>
        <p className={HEADER_PATH_CLASS} title={selectedPathLabel}>
          {selectedPathLabel}
        </p>
        {progress}
        {toolbar}
      </header>
      {editError}
      {body}
      {inlinePrompt}
    </section>
  );
}
