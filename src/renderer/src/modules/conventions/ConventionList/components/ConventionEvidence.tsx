import { ExternalLinkIcon } from '@renderer/components/icons/ExternalLinkIcon';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';

export interface ConventionEvidenceRepositoryItem {
  repoKey: string;
  url: string;
  /** Names its destination, so several links under one rule are told apart by a reader. */
  linkLabel: string;
}

export interface ConventionEvidenceCommentItem {
  commentId: string;
}

export interface ConventionEvidenceView {
  /** Closed by default: a rule is read first, and its receipts are opened on demand. */
  summaryLabel: string;
  explanation: string;
  repositoriesLabel: string;
  repositories: ConventionEvidenceRepositoryItem[];
  hasRepositories: boolean;
  noRepositoriesLabel: string;
  commentsLabel: string;
  comments: ConventionEvidenceCommentItem[];
  hasComments: boolean;
  noCommentsLabel: string;
}

export interface ConventionEvidenceProps {
  view: ConventionEvidenceView;
}

const EXTERNAL_LINK_ICON_SIZE = 12;

const DETAILS_CLASS = 'border-border rounded-md border border-dashed p-2';
const SUMMARY_CLASS = joinClassNames(
  'text-muted hover:text-ink cursor-pointer rounded text-xs font-medium',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
);
const BODY_CLASS = 'mt-2 flex flex-col gap-2';
const GROUP_CLASS = 'flex flex-col gap-1';
const GROUP_LABEL_CLASS = 'text-muted text-xs font-medium tracking-wide uppercase';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const LINK_LIST_CLASS = 'flex flex-wrap gap-x-3 gap-y-1';
const LINK_CLASS = joinClassNames(
  'text-accent hover:text-ink inline-flex items-center gap-1 rounded text-xs',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
);
const ID_LIST_CLASS = 'flex flex-wrap gap-x-3 gap-y-1';
const ID_CLASS = 'text-muted font-mono text-xs break-all';

/**
 * The receipts behind a rule. Evidence is what makes a convention checkable rather than
 * a claim, so it is reachable from the rule instead of being summarised into a count —
 * and it is rendered here and never written to a log, because a review comment can
 * quote repository contents exactly like an agent transcript can.
 *
 * The comment ids are shown rather than linked because `conventions.list()` returns the
 * ids a rule was distilled from, not the stored evidence records that hold each
 * comment's URL. The repositories they came from are linked, which is as deep as the
 * data on a rule reaches.
 */
export function ConventionEvidence({ view }: ConventionEvidenceProps) {
  const repositoryLinks = view.repositories.map((repository) => (
    <li key={repository.repoKey}>
      <a href={repository.url} target="_blank" rel="noreferrer" className={LINK_CLASS}>
        {repository.linkLabel}
        <ExternalLinkIcon size={EXTERNAL_LINK_ICON_SIZE} />
      </a>
    </li>
  ));

  const commentIds = view.comments.map((comment) => (
    <li key={comment.commentId} className={ID_CLASS}>
      {comment.commentId}
    </li>
  ));

  const repositories = view.hasRepositories ? (
    <ul className={LINK_LIST_CLASS}>{repositoryLinks}</ul>
  ) : (
    <p className={EXPLANATION_CLASS}>{view.noRepositoriesLabel}</p>
  );

  const comments = view.hasComments ? (
    <ul className={ID_LIST_CLASS}>{commentIds}</ul>
  ) : (
    <p className={EXPLANATION_CLASS}>{view.noCommentsLabel}</p>
  );

  return (
    <details className={DETAILS_CLASS}>
      <summary className={SUMMARY_CLASS}>{view.summaryLabel}</summary>
      <div className={BODY_CLASS}>
        <p className={EXPLANATION_CLASS}>{view.explanation}</p>
        <div className={GROUP_CLASS}>
          <p className={GROUP_LABEL_CLASS}>{view.repositoriesLabel}</p>
          {repositories}
        </div>
        <div className={GROUP_CLASS}>
          <p className={GROUP_LABEL_CLASS}>{view.commentsLabel}</p>
          {comments}
        </div>
      </div>
    </details>
  );
}
