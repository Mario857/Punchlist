import { DiffEditor } from '@monaco-editor/react';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { joinClassNames } from '@renderer/lib/classNames';
import { ChangedFilesTree } from '@renderer/modules/review/DiffReview/components/ChangedFilesTree/ChangedFilesTree';
import { useDiffReview } from '@renderer/modules/review/DiffReview/useDiffReview';

export interface DiffReviewProps {
  runId: string;
  /**
   * Set while the agent amends the patch. The diff stays on screen dimmed with this
   * inline: swapping to a transcript would throw away the context being read.
   */
  revisionProgressLabel?: string | null;
}

const SECTION_LABEL = 'Candidate patch';
const EDITOR_LOADING_LABEL = 'Loading the diff';
const FILE_TREE_CLASS = 'border-border w-56 shrink-0 overflow-y-auto border-r pr-1';
const HEADER_PATH_CLASS = 'text-ink min-w-0 flex-1 truncate font-mono text-xs';
const PROGRESS_CLASS = 'text-state-revising flex items-center gap-1.5 text-xs';
const DIFF_BODY_CLASS = 'flex min-h-0 flex-1';
const DIMMED_CLASS = 'opacity-50';

export function DiffReview({ runId, revisionProgressLabel }: DiffReviewProps) {
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
    onSelectPath,
  } = useDiffReview({ runId, revisionProgressLabel });

  const progress =
    progressLabel === null ? null : (
      <p role="status" className={PROGRESS_CLASS}>
        <Spinner size={SPINNER_SIZE.SM} label={progressLabel} />
        {progressLabel}
      </p>
    );

  const diffBodyClassName = isDimmed
    ? joinClassNames(DIFF_BODY_CLASS, DIMMED_CLASS)
    : DIFF_BODY_CLASS;

  const body = (() => {
    if (isCandidatePatchLoading) {
      return (
        <div className="grid flex-1 place-items-center">
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
            loading={<Spinner size={SPINNER_SIZE.MD} label={EDITOR_LOADING_LABEL} />}
          />
        </div>
      </div>
    );
  })();

  return (
    <section aria-label={SECTION_LABEL} className="flex min-h-0 flex-1 flex-col gap-2">
      <header className="flex items-center gap-2">
        <p className={HEADER_PATH_CLASS} title={selectedPathLabel}>
          {selectedPathLabel}
        </p>
        {progress}
      </header>
      {body}
    </section>
  );
}
