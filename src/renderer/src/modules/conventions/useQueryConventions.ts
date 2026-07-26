import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ConventionExportPreview,
  ConventionRule,
  ConventionState,
  ExportConventionsRequest,
} from '@shared/conventions';
import { invariant } from '@renderer/lib/guards';
import { logError } from '@renderer/lib/logError';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

const NO_REPO_KEY = '';

/**
 * Every convention mutation resolves with rules, but whether that array is the whole
 * corpus or only the records it touched is main's business. Invalidating rather than
 * writing the cache from the response keeps a rule from ever being shown in a state
 * main did not put it in — and the same edit changes what an export would write, so
 * the previews go with it.
 */
function invalidateConventions(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.conventions() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.conventionExportPreviews() });
}

interface UseQueryConventionsResult {
  conventionRules: ConventionRule[] | undefined;
  isConventionRulesLoading: boolean;
  isConventionRulesFetching: boolean;
  conventionRulesError: unknown;
  refetchConventionRules: () => void;
}

/**
 * The whole rule corpus in one read. Nothing changes it but a distillation the user
 * asked for or a decision the user made, so it never refetches on its own: a list that
 * reshuffled under a half-read rule would be worse than a slightly old one.
 */
export function useQueryConventions(): UseQueryConventionsResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.conventions(),
    queryFn: async () => unwrapIpcResult(await requireBridge().conventions.list()),
    refetchOnWindowFocus: false,
  });

  return {
    conventionRules: data,
    isConventionRulesLoading: isLoading,
    isConventionRulesFetching: isFetching,
    conventionRulesError: error,
    refetchConventionRules: () => {
      void refetch();
    },
  };
}

interface UseQueryConventionExportPreviewResult {
  conventionExportPreview: ConventionExportPreview | undefined;
  isConventionExportPreviewLoading: boolean;
  isConventionExportPreviewFetching: boolean;
  conventionExportPreviewError: unknown;
  refetchConventionExportPreview: () => void;
}

/**
 * The exact bytes of both files, rendered by main from the confirmed rules. It is the
 * only thing standing between a confirmation and a write into a real repository, so it
 * is fetched from main rather than assembled here: what is read has to be what is
 * written, and a renderer-side rendering of the same rules could differ.
 */
export function useQueryConventionExportPreview(
  repoKey: string | null,
): UseQueryConventionExportPreviewResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.conventionExportPreview(repoKey ?? NO_REPO_KEY),
    queryFn: async () => {
      invariant(repoKey !== null, 'convention export preview query ran without a repo');
      return unwrapIpcResult(await requireBridge().conventions.previewExport(repoKey));
    },
    enabled: repoKey !== null,
    refetchOnWindowFocus: false,
  });

  return {
    conventionExportPreview: data,
    isConventionExportPreviewLoading: isLoading,
    isConventionExportPreviewFetching: isFetching,
    conventionExportPreviewError: error,
    refetchConventionExportPreview: () => {
      void refetch();
    },
  };
}

interface UseExecuteDistillConventionsResult {
  distillConventions: () => void;
  isDistillConventionsPending: boolean;
  distillConventionsError: unknown;
  /** Undefined until a distillation has finished; drives the "it ran" notice. */
  distilledConventionRules: ConventionRule[] | undefined;
}

/**
 * One free-lane agent over every undistilled comment, batched on purpose: a call per
 * comment could not deduplicate and would emit twenty near-identical naming rules.
 * That makes it slow rather than instant, which is what the copy beside it says.
 */
export function useExecuteDistillConventions(): UseExecuteDistillConventionsResult {
  const queryClient = useQueryClient();

  const { mutate, isPending, error, data } = useMutation({
    mutationFn: async () => unwrapIpcResult(await requireBridge().conventions.distill()),
    onSuccess: () => invalidateConventions(queryClient),
    // The proposed rules quote the comments they were distilled from, so only the
    // failure is logged — never the rules that came back with it.
    onError: (mutationError) => logError(mutationError, 'useExecuteDistillConventions'),
  });

  return {
    distillConventions: mutate,
    isDistillConventionsPending: isPending,
    distillConventionsError: error,
    distilledConventionRules: data,
  };
}

export interface SetConventionStateRequest {
  ruleId: string;
  state: ConventionState;
}

interface UseExecuteSetConventionStateResult {
  setConventionState: (request: SetConventionStateRequest) => void;
  isSetConventionStatePending: boolean;
  setConventionStateError: unknown;
}

/**
 * Confirm, reject, or move a decided rule back to a candidate. Nothing is optimistic:
 * a rejection is a persisted state that distillation reads to avoid re-proposing the
 * same rule, so it must never read as remembered before main has remembered it.
 */
export function useExecuteSetConventionState(): UseExecuteSetConventionStateResult {
  const queryClient = useQueryClient();

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (request: SetConventionStateRequest) =>
      unwrapIpcResult(await requireBridge().conventions.setState(request.ruleId, request.state)),
    onSuccess: () => invalidateConventions(queryClient),
    // The request carries only an id and a state, so there is no rule text in it.
    onError: (mutationError) => logError(mutationError, 'useExecuteSetConventionState'),
  });

  return {
    setConventionState: mutate,
    isSetConventionStatePending: isPending,
    setConventionStateError: error,
  };
}

interface UseExecuteExportConventionsResult {
  exportConventions: (request: ExportConventionsRequest) => void;
  /** Undefined until an export has succeeded; a write is never shown ahead of main. */
  exportedConventionRules: ConventionRule[] | undefined;
  /**
   * Which repository that success belongs to. Without it, exporting one repository would
   * leave every other repository's gate reading as already written.
   */
  exportedRepoKey: string | undefined;
  isExportConventionsPending: boolean;
  exportConventionsError: unknown;
}

/**
 * Writes into the user's real repository, so it is gated and audited exactly like a
 * landing. `onSettled` rather than `onSuccess` for the same reason: two files are
 * written, and a failure on the second one has still changed the first.
 */
export function useExecuteExportConventions(): UseExecuteExportConventionsResult {
  const queryClient = useQueryClient();

  const { mutate, data, isPending, isSuccess, variables, error } = useMutation({
    mutationFn: async (request: ExportConventionsRequest) =>
      unwrapIpcResult(await requireBridge().conventions.export(request)),
    onSettled: () => {
      invalidateConventions(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditLog() });
    },
    onError: (mutationError) => logError(mutationError, 'useExecuteExportConventions'),
  });

  return {
    exportConventions: mutate,
    exportedConventionRules: data,
    exportedRepoKey: isSuccess ? variables.repoKey : undefined,
    isExportConventionsPending: isPending,
    exportConventionsError: error,
  };
}
