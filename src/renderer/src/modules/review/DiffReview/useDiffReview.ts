import { useCallback, useState } from 'react';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// The worker specifier goes through monaco's exports map, where `./*` maps to
// `./esm/vs/*.js` — the older `monaco-editor/esm/vs/...` path no longer resolves.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { CandidatePatchFile } from '@shared/runs';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useQueryCandidatePatch } from '@renderer/modules/runs/useQueryRuns';
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
/** The editor fills its flex parent rather than guessing a pixel height. */
const MONACO_HEIGHT = '100%';
const MONACO_FONT_SIZE = 12;
const MONACO_LINE_HEIGHT = 18;

/**
 * The candidate patch is read from git, never from an editor buffer, so this editor is
 * a viewer: both sides are read-only and `originalEditable` stays off explicitly rather
 * than by default, since the base commit is not something a review may rewrite.
 */
const DIFF_EDITOR_OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
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

const LOADING_PATH_LABEL = 'Loading the candidate patch…';
const NO_FILE_PATH_LABEL = 'No file selected';
const PATCH_ERROR_FALLBACK = 'Could not read the candidate patch from the worktree.';
const EMPTY_PATCH_HEADING = 'This run produced no changes';
const EMPTY_PATCH_EXPLANATION =
  'The agent finished without touching any file. That is a real outcome, not a failure: the comment may already be satisfied by the code as it stands.';

function languageOf(path: string): string {
  const extension = path.split(EXTENSION_SEPARATOR).at(-1);
  if (extension === undefined) return DEFAULT_LANGUAGE;
  return LANGUAGE_BY_EXTENSION[extension.toLowerCase()] ?? DEFAULT_LANGUAGE;
}

export function useDiffReview({
  runId,
  revisionProgressLabel = null,
}: UseDiffReviewOptions): UseDiffReviewResult {
  const run = useRun(runId);
  const [requestedPath, setRequestedPath] = useState<string | null>(null);

  // Every revision is its own commit in the worktree, so the counter is exactly when
  // the patch on disk stopped matching the one already fetched.
  const revisionCount = isDefined(run) ? run.revisionCount : NO_REVISIONS;
  const { candidatePatch, isCandidatePatchLoading, candidatePatchError } = useQueryCandidatePatch(
    runId,
    revisionCount,
  );

  const files = isDefined(candidatePatch) ? candidatePatch.files : EMPTY_FILES;
  const hasFiles = files.length > EMPTY_LENGTH;

  // A path the user picked survives a refetch, but a revision can delete the file it
  // pointed at, so the first file is the fallback rather than an empty editor.
  const selectedFile = (() => {
    const requested = files.find((file) => file.path === requestedPath);
    if (requested !== undefined) return requested;
    return files.at(0);
  })();

  const selectedPathLabel = (() => {
    if (isDefined(selectedFile)) return selectedFile.path;
    if (isCandidatePatchLoading) return LOADING_PATH_LABEL;
    return NO_FILE_PATH_LABEL;
  })();

  const onSelectPath = useCallback((path: string) => setRequestedPath(path), []);

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
    selectedPath: isDefined(selectedFile) ? selectedFile.path : null,
    selectedPathLabel,
    originalContent: isDefined(selectedFile) ? selectedFile.originalContent : EMPTY_CONTENT,
    modifiedContent: isDefined(selectedFile) ? selectedFile.modifiedContent : EMPTY_CONTENT,
    language: isDefined(selectedFile) ? languageOf(selectedFile.path) : DEFAULT_LANGUAGE,
    isDimmed: isDefined(revisionProgressLabel),
    progressLabel: revisionProgressLabel,
    editorOptions: DIFF_EDITOR_OPTIONS,
    editorTheme: MONACO_THEME,
    editorHeight: MONACO_HEIGHT,
    onSelectPath,
  };
}
