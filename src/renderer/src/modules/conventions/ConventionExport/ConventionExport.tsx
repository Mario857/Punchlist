import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import {
  DISABLED_STATE,
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
} from '@renderer/components/interactiveClassNames';
import { assertNever } from '@renderer/lib/assertNever';
import { joinClassNames } from '@renderer/lib/classNames';
import {
  CONVENTION_EXPORT_VIEW_KIND,
  useConventionExport,
} from '@renderer/modules/conventions/ConventionExport/useConventionExport';

const SECTION_LABEL = 'Convention export';
/** A scrollable region must be reachable by keyboard, not only by wheel or trackpad. */
const FILE_CONTENT_TAB_INDEX = 0;

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const NOTICE_CLASS = 'text-warning text-xs leading-relaxed';
const EMPTY_STATE_CLASS = 'text-muted text-xs leading-relaxed';
const STATUS_CLASS = 'text-muted flex items-center gap-2 text-xs';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const REMEDIATION_CLASS = 'text-muted text-xs leading-relaxed';
const WARNING_CLASS = 'text-warning text-xs leading-relaxed';
const SUCCESS_CLASS = 'text-success text-xs leading-relaxed';
const BLOCKER_CLASS = 'text-warning text-xs leading-relaxed';
const PENDING_CLASS = 'text-muted text-xs leading-relaxed';
const RULE_COUNT_CLASS = 'text-ink text-xs font-medium';
const ACTION_ROW_CLASS = 'flex flex-wrap items-center gap-2';

const SELECT_ROW_CLASS = 'flex flex-wrap items-center gap-2';
const SELECT_LABEL_CLASS = 'text-ink text-xs font-medium';
const SELECT_CLASS = joinClassNames(
  'h-9 min-w-0 shrink-0 rounded-md border px-2',
  'text-sm',
  'border-border bg-surface-raised text-ink',
  'hover:border-border-strong',
  FOCUS_RING,
  INTERACTIVE_TRANSITION,
  DISABLED_STATE,
);

const FILE_LIST_CLASS = 'flex flex-col gap-3';
const FILE_CLASS = 'border-border flex flex-col gap-1 rounded-md border p-2';
const FILE_HEADING_CLASS = 'text-ink text-xs font-semibold';
const FILE_PATH_CLASS = 'text-accent font-mono text-xs break-all';
const FILE_CONTENT_CLASS = joinClassNames(
  'border-border bg-bg-0/60 max-h-64 overflow-auto rounded-md border p-2',
  'font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
  'text-muted',
  FOCUS_RING,
);

/**
 * The export gate. It shows the two literal paths and the literal bytes that would land
 * at them, because someone confirming a write into their own repository should be able
 * to read the file first — and confirming is a click on a button that names both
 * destinations, never a shortcut.
 */
export function ConventionExport() {
  const {
    heading,
    explanation,
    guardrailNoticeLabel,
    repoSelectId,
    repoSelectLabel,
    repoSelectValue,
    repoOptions,
    hasRepoOptions,
    noRepoOptionsLabel,
    onRepoKeyChange,
    view,
  } = useConventionExport();

  const repoOptionElements = repoOptions.map((option) => (
    <option key={option.repoKey} value={option.repoKey}>
      {option.label}
    </option>
  ));

  const repoSelector = hasRepoOptions ? (
    <div className={SELECT_ROW_CLASS}>
      <label htmlFor={repoSelectId} className={SELECT_LABEL_CLASS}>
        {repoSelectLabel}
      </label>
      <select
        id={repoSelectId}
        value={repoSelectValue}
        onChange={onRepoKeyChange}
        className={SELECT_CLASS}
      >
        {repoOptionElements}
      </select>
    </div>
  ) : (
    <p className={EMPTY_STATE_CLASS}>{noRepoOptionsLabel}</p>
  );

  const content = (() => {
    switch (view.kind) {
      case CONVENTION_EXPORT_VIEW_KIND.NOTHING_TO_EXPORT:
        return <p className={EMPTY_STATE_CLASS}>{view.emptyStateLabel}</p>;
      case CONVENTION_EXPORT_VIEW_KIND.PREVIEWING:
        return (
          <p role="status" className={STATUS_CLASS}>
            <Spinner size={SPINNER_SIZE.SM} label={view.previewingLabel} />
            {view.previewingLabel}
          </p>
        );
      case CONVENTION_EXPORT_VIEW_KIND.FAILED: {
        const remediation =
          view.errorRemediation === null ? null : (
            <p className={REMEDIATION_CLASS}>{view.errorRemediation}</p>
          );

        return (
          <div className={COLUMN_CLASS}>
            <p role="alert" className={ERROR_CLASS}>
              {view.errorMessage}
            </p>
            {remediation}
            <div className={ACTION_ROW_CLASS}>
              <Button
                variant={BUTTON_VARIANT.SECONDARY}
                size={BUTTON_SIZE.SM}
                onClick={view.onRetryClick}
              >
                {view.retryLabel}
              </Button>
            </div>
          </div>
        );
      }
      case CONVENTION_EXPORT_VIEW_KIND.PREVIEW: {
        const fileItems = view.files.map((file) => {
          const body = file.isEmpty ? (
            <p className={EMPTY_STATE_CLASS}>{file.emptyLabel}</p>
          ) : (
            <pre
              tabIndex={FILE_CONTENT_TAB_INDEX}
              aria-label={file.heading}
              className={FILE_CONTENT_CLASS}
            >
              {file.content}
            </pre>
          );

          return (
            <li key={file.id} className={FILE_CLASS}>
              <h4 className={FILE_HEADING_CLASS}>{file.heading}</h4>
              <p className={FILE_PATH_CLASS}>{file.path}</p>
              <p className={EXPLANATION_CLASS}>{file.explanation}</p>
              {body}
            </li>
          );
        });

        const blocker =
          view.blockerLabel === null ? null : (
            <p role="status" className={BLOCKER_CLASS}>
              {view.blockerLabel}
            </p>
          );

        const pending =
          view.pendingLabel === null ? null : (
            <p role="status" className={PENDING_CLASS}>
              {view.pendingLabel}
            </p>
          );

        const success =
          view.successLabel === null ? null : (
            <p role="status" className={SUCCESS_CLASS}>
              {view.successLabel}
            </p>
          );

        const failureView = view.failure;

        const failureRemediation =
          failureView === null || failureView.remediation === null ? null : (
            <p className={REMEDIATION_CLASS}>{failureView.remediation}</p>
          );

        // Grouped under one alert so the message, the "this stopped partway" notice and
        // the pointer at the audit log are announced together.
        const failure =
          failureView === null ? null : (
            <div role="alert" className={COLUMN_CLASS}>
              <p className={ERROR_CLASS}>{failureView.message}</p>
              {failureRemediation}
              <p className={WARNING_CLASS}>{failureView.partialWarningLabel}</p>
              <p className={EXPLANATION_CLASS}>{failureView.auditNoticeLabel}</p>
            </div>
          );

        return (
          <div className={COLUMN_CLASS}>
            <ol className={FILE_LIST_CLASS}>{fileItems}</ol>
            <p className={RULE_COUNT_CLASS}>{view.ruleCountLabel}</p>
            <p className={EXPLANATION_CLASS}>{view.exportEffectLabel}</p>
            {blocker}
            {pending}
            {success}
            {failure}
            <div className={ACTION_ROW_CLASS}>
              <Button
                variant={BUTTON_VARIANT.PRIMARY}
                size={BUTTON_SIZE.MD}
                isDisabled={view.isConfirmDisabled}
                isLoading={view.isConfirmExecuting}
                title={view.confirmLabel}
                onClick={view.onConfirmClick}
              >
                {view.confirmLabel}
              </Button>
            </div>
          </div>
        );
      }
      default:
        return assertNever(view);
    }
  })();

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD}>
      <section aria-label={SECTION_LABEL} className={COLUMN_CLASS}>
        <header>
          <h3 className={HEADING_CLASS}>{heading}</h3>
          <p className={EXPLANATION_CLASS}>{explanation}</p>
        </header>
        <p className={NOTICE_CLASS}>{guardrailNoticeLabel}</p>
        {repoSelector}
        {content}
      </section>
    </Card>
  );
}
