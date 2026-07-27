import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import type { LandingConfirmView } from '@renderer/modules/landing/LandingPreview/landingPreviewModel';

interface Props {
  view: LandingConfirmView;
}

const COLUMN_CLASS = 'flex flex-col gap-2';
const HEADING_CLASS = 'text-ink text-sm font-semibold';
const EXPLANATION_CLASS = 'text-muted text-xs leading-relaxed';
const BLOCKER_CLASS = 'text-warning text-xs leading-relaxed';
const PENDING_CLASS = 'text-muted text-xs leading-relaxed';
const SUCCESS_CLASS = 'text-success text-xs leading-relaxed';
const ERROR_CLASS = 'text-danger text-xs leading-relaxed';
const REMEDIATION_CLASS = 'text-muted text-xs leading-relaxed';
const WARNING_CLASS = 'text-warning text-xs leading-relaxed';
const NOTICE_CLASS = 'text-muted text-xs leading-relaxed';
const ACTION_ROW_CLASS = 'flex items-center gap-2';

/**
 * The outer door. It carries no keyboard binding and is not autofocused, on purpose: a
 * shortcut may open this preview, but confirming is a click, because the one action that
 * reaches the real repository must not become muscle memory.
 *
 * The button's label is its accessible name and names the effects — which branch to which
 * remote, how many threads, whether a comment is posted — because "Confirm" describes the
 * gesture and this control is the only one in the app whose consequences leave the machine.
 */
export function LandingConfirmBar({ view }: Props) {
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

  const remediation =
    failureView === null || failureView.remediation === null ? null : (
      <p className={REMEDIATION_CLASS}>{failureView.remediation}</p>
    );

  // Grouped under one alert so the message, the "this stopped partway" notice and the
  // pointer at the audit log are announced together — the notice is the part that keeps
  // a failure from reading as though the repository was left untouched.
  const failure =
    failureView === null ? null : (
      <div role="alert" className={COLUMN_CLASS}>
        <p className={ERROR_CLASS}>{failureView.message}</p>
        {remediation}
        <p className={WARNING_CLASS}>{failureView.partialWarningLabel}</p>
        <p className={NOTICE_CLASS}>{failureView.auditNoticeLabel}</p>
      </div>
    );

  const publishView = view.publish;
  const publish = (() => {
    if (publishView === null) return null;

    const pushed =
      publishView.pushedLabel === null ? null : (
        <p role="status" className={SUCCESS_CLASS}>
          {publishView.pushedLabel}
        </p>
      );
    const pushError =
      publishView.pushErrorMessage === null ? null : (
        <p role="alert" className={ERROR_CLASS}>
          {publishView.pushErrorMessage}
        </p>
      );
    const resolved =
      publishView.resolvedLabel === null ? null : (
        <p role="status" className={SUCCESS_CLASS}>
          {publishView.resolvedLabel}
        </p>
      );
    const resolveError =
      publishView.resolveErrorMessage === null ? null : (
        <p role="alert" className={ERROR_CLASS}>
          {publishView.resolveErrorMessage}
        </p>
      );

    return (
      <div className={COLUMN_CLASS}>
        <div className={ACTION_ROW_CLASS}>
          <Button
            variant={BUTTON_VARIANT.SECONDARY}
            size={BUTTON_SIZE.SM}
            isLoading={publishView.isPushPending}
            onClick={publishView.onPushClick}
          >
            {publishView.pushLabel}
          </Button>
          <Button
            variant={BUTTON_VARIANT.SECONDARY}
            size={BUTTON_SIZE.SM}
            isLoading={publishView.isResolvePending}
            onClick={publishView.onResolveClick}
          >
            {publishView.resolveLabel}
          </Button>
        </div>
        {pushed}
        {pushError}
        {resolved}
        {resolveError}
      </div>
    );
  })();

  return (
    <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.MD} className={COLUMN_CLASS}>
      <h3 className={HEADING_CLASS}>{view.heading}</h3>
      <p className={EXPLANATION_CLASS}>{view.explanation}</p>
      {blocker}
      {pending}
      {success}
      {publish}
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
    </Card>
  );
}
