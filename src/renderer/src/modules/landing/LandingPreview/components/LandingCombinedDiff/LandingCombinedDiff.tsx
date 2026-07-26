import { DiffEditor } from '@monaco-editor/react';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { ChangedFilesTree } from '@renderer/modules/review/DiffReview/components/ChangedFilesTree/ChangedFilesTree';
import { useLandingCombinedDiff } from '@renderer/modules/landing/LandingPreview/components/LandingCombinedDiff/useLandingCombinedDiff';
import type { LandingCombinedDiffView } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

interface Props {
  view: LandingCombinedDiffView;
}

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const HEADER_PATH_CLASS = 'text-ink min-w-0 flex-1 truncate font-mono text-xs';
const BODY_CLASS = 'flex min-h-0';
const FILE_TREE_CLASS = 'border-border w-56 shrink-0 overflow-y-auto border-r pr-1';
const EDITOR_CLASS = 'min-w-0 flex-1';

/**
 * The same viewer the review pane uses, over the merged result rather than one run's
 * patch: what is confirmed here is this diff, so it is shown at the fidelity it was
 * reviewed at rather than summarised into a file list.
 */
export function LandingCombinedDiff({ view }: Props) {
  const {
    selectedPath,
    selectedPathLabel,
    originalContent,
    modifiedContent,
    language,
    editorOptions,
    editorTheme,
    editorHeight,
    editorLoadingLabel,
    onSelectPath,
  } = useLandingCombinedDiff({ files: view.files });

  const body = view.hasChanges ? (
    <div className={BODY_CLASS}>
      <div className={FILE_TREE_CLASS}>
        <ChangedFilesTree
          files={view.files}
          selectedPath={selectedPath}
          onSelectPath={onSelectPath}
        />
      </div>
      <div className={EDITOR_CLASS}>
        <DiffEditor
          original={originalContent}
          modified={modifiedContent}
          language={language}
          theme={editorTheme}
          height={editorHeight}
          options={editorOptions}
          loading={<Spinner size={SPINNER_SIZE.MD} label={editorLoadingLabel} />}
        />
      </div>
    </div>
  ) : (
    <p className={EXPLANATION_CLASS}>{view.emptyLabel}</p>
  );

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <div>
        <h3 className={HEADING_CLASS}>{view.heading}</h3>
        <p className={EXPLANATION_CLASS}>{view.explanation}</p>
      </div>
      <p className={HEADER_PATH_CLASS} title={selectedPathLabel}>
        {selectedPathLabel}
      </p>
      {body}
    </Card>
  );
}
