import { useCallback, useState } from 'react';
import * as monaco from 'monaco-editor';
// monaco's loader and its diff worker are configured once, in the review module's diff
// hook: the app's CSP blocks monaco's default CDN fetch outright, so an unconfigured
// loader renders no diff at all. Imported here for that side effect rather than repeating
// the configuration, which could then drift from the one the review pane uses.
import '@renderer/modules/review/DiffReview/useDiffReview';
import type { CandidatePatchFile } from '@shared/runs';
import { isDefined } from '@renderer/lib/guards';

export interface UseLandingCombinedDiffOptions {
  files: readonly CandidatePatchFile[];
}

interface UseLandingCombinedDiffResult {
  selectedPath: string | null;
  selectedPathLabel: string;
  originalContent: string;
  modifiedContent: string;
  language: string;
  editorOptions: monaco.editor.IDiffEditorConstructionOptions;
  editorTheme: string;
  editorHeight: string;
  editorLoadingLabel: string;
  onSelectPath: (path: string) => void;
}

const EXTENSION_SEPARATOR = '.';
const DEFAULT_LANGUAGE = 'plaintext';
const EMPTY_CONTENT = '';

const NO_FILE_PATH_LABEL = 'No file selected';
const EDITOR_LOADING_LABEL = 'Loading the combined diff';

const MONACO_THEME = 'vs-dark';
const MONACO_FONT_SIZE = 12;
const MONACO_LINE_HEIGHT = 18;

/**
 * The gate is a reading surface, so unlike the review pane's editor neither side is
 * editable: a landing commits what was already reviewed, and an edit made here would
 * belong to no worktree and reach no commit.
 */
const COMBINED_DIFF_EDITOR_OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderOverviewRuler: false,
  fontSize: MONACO_FONT_SIZE,
  lineHeight: MONACO_LINE_HEIGHT,
};

/**
 * Tall enough to read a hunk without becoming the whole gate: the preview is a column of
 * sections and the diff is one of them, so it cannot simply fill its parent the way the
 * review pane's editor does.
 */
const COMBINED_DIFF_EDITOR_HEIGHT = '28rem';

/**
 * Built from monaco's own registry rather than a second hand-kept extension table, so the
 * combined diff highlights exactly what the review pane's editor highlights.
 */
const LANGUAGE_ID_BY_EXTENSION: ReadonlyMap<string, string> = new Map(
  monaco.languages.getLanguages().flatMap((language) =>
    // The registry types every field as optional; a language with no extensions
    // contributes nothing rather than being skipped by a guard further down.
    (language.extensions ?? []).map((extension): [string, string] => [
      extension.toLowerCase(),
      language.id,
    ]),
  ),
);

function languageOf(path: string): string {
  const extension = path.split(EXTENSION_SEPARATOR).at(-1);
  if (extension === undefined) return DEFAULT_LANGUAGE;
  const languageId = LANGUAGE_ID_BY_EXTENSION.get(
    `${EXTENSION_SEPARATOR}${extension.toLowerCase()}`,
  );
  return isDefined(languageId) ? languageId : DEFAULT_LANGUAGE;
}

/**
 * The combined diff is served from the assembled preview rather than fetched per run, so
 * this hook only picks which file is on screen — the artifact itself is whatever the
 * sandbox merge produced.
 */
export function useLandingCombinedDiff({
  files,
}: UseLandingCombinedDiffOptions): UseLandingCombinedDiffResult {
  const [requestedPath, setRequestedPath] = useState<string | null>(null);

  // A path the user picked survives a re-assemble, but a re-run can drop the file it
  // pointed at, so the first file is the fallback rather than an empty editor.
  const selectedFile = (() => {
    const requested = files.find((file) => file.path === requestedPath);
    if (requested !== undefined) return requested;
    return files.at(0);
  })();

  const onSelectPath = useCallback((path: string) => setRequestedPath(path), []);

  return {
    selectedPath: isDefined(selectedFile) ? selectedFile.path : null,
    selectedPathLabel: isDefined(selectedFile) ? selectedFile.path : NO_FILE_PATH_LABEL,
    originalContent: isDefined(selectedFile) ? selectedFile.originalContent : EMPTY_CONTENT,
    modifiedContent: isDefined(selectedFile) ? selectedFile.modifiedContent : EMPTY_CONTENT,
    language: isDefined(selectedFile) ? languageOf(selectedFile.path) : DEFAULT_LANGUAGE,
    editorOptions: COMBINED_DIFF_EDITOR_OPTIONS,
    editorTheme: MONACO_THEME,
    editorHeight: COMBINED_DIFF_EDITOR_HEIGHT,
    editorLoadingLabel: EDITOR_LOADING_LABEL,
    onSelectPath,
  };
}
