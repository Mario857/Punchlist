import { useQuery } from '@tanstack/react-query';
import type { AssembleLandingRequest, LandingPreview } from '@shared/landing';
import { invariant } from '@renderer/lib/guards';
import { queryKeys } from '@renderer/lib/queryKeys';
import { requireBridge, unwrapIpcResult } from '@renderer/lib/unwrapIpcResult';

const NO_PR_REPO_KEY = '';
const NO_PR_NUMBER = 0;
const NO_TARGET_BRANCH = '';

/**
 * Assembling is not a read: it creates a sandbox worktree and squash-merges every
 * approved branch into it. Refetching that on a window focus would swap the artifact
 * the confirmation is about while it is being read, so the preview never goes stale on
 * its own and re-assembling is an action the user takes.
 */
const PREVIEW_STALE_TIME_MS = Number.POSITIVE_INFINITY;

interface UseQueryLandingPreviewResult {
  landingPreview: LandingPreview | undefined;
  isLandingPreviewLoading: boolean;
  /** True during a re-assemble too, where the previous preview is still on screen. */
  isLandingPreviewFetching: boolean;
  landingPreviewError: unknown;
  refetchLandingPreview: () => void;
}

/**
 * The whole preview comes from one call, because main assembles it by performing the
 * merges rather than predicting them — conflicts are findings, not guesses, and they
 * are found while the real repository is still untouched.
 */
export function useQueryLandingPreview(
  request: AssembleLandingRequest | null,
): UseQueryLandingPreviewResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.landingPreview(
      request?.prRef.repoKey ?? NO_PR_REPO_KEY,
      request?.prRef.number ?? NO_PR_NUMBER,
      request?.targetBranch ?? NO_TARGET_BRANCH,
    ),
    queryFn: async () => {
      invariant(request !== null, 'landing preview query ran without a request');
      return unwrapIpcResult(await requireBridge().landing.assemble(request));
    },
    enabled: request !== null,
    staleTime: PREVIEW_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

  return {
    landingPreview: data,
    isLandingPreviewLoading: isLoading,
    isLandingPreviewFetching: isFetching,
    landingPreviewError: error,
    refetchLandingPreview: () => {
      void refetch();
    },
  };
}
