import { Badge } from '@renderer/components/Badge';
import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING } from '@renderer/components/Card';
import { Spinner, SPINNER_SIZE } from '@renderer/components/Spinner';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { CheckIcon } from '@renderer/components/icons/CheckIcon';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { isDefined } from '@renderer/lib/guards';
import { joinClassNames } from '@renderer/lib/classNames';
import { useGhAuthStatusCard } from '@renderer/modules/settings/GhAuthStatusCard/useGhAuthStatusCard';

const DETAIL_TERM_CLASS = 'text-muted text-xs uppercase tracking-wide';
const DETAIL_VALUE_CLASS = 'text-ink mt-0.5 truncate text-sm';

export function GhAuthStatusCard() {
  const {
    isGhAuthStatusLoading,
    isAuthenticated,
    statusLabel,
    statusTone,
    loginLabel,
    hostLabel,
    scopesLabel,
    problemTitle,
    problemMessage,
    remediation,
    copyRemediationLabel,
    onCopyRemediationClick,
    onRecheckClick,
  } = useGhAuthStatusCard();

  const remediationBlock = isDefined(remediation) ? (
    <div className="border-border bg-bg-0 mt-3 flex items-center gap-2 rounded-md border p-2">
      <code className="text-ink min-w-0 flex-1 truncate font-mono text-xs">{remediation}</code>
      <Button
        size={BUTTON_SIZE.SM}
        variant={BUTTON_VARIANT.SECONDARY}
        onClick={onCopyRemediationClick}
      >
        {copyRemediationLabel}
      </Button>
    </div>
  ) : null;

  const problemBlock = isDefined(problemTitle) ? (
    <div role="alert" className="mt-4">
      <p className="text-ink flex items-center gap-2 text-sm font-medium">
        <AlertTriangleIcon className="text-warning" />
        {problemTitle}
      </p>
      <p className="text-muted mt-1 text-sm leading-relaxed">{problemMessage}</p>
      {remediationBlock}
    </div>
  ) : null;

  const authenticatedDetails = isAuthenticated ? (
    <dl className="mt-4 grid grid-cols-3 gap-4">
      <div className="min-w-0">
        <dt className={DETAIL_TERM_CLASS}>Login</dt>
        <dd className={joinClassNames(DETAIL_VALUE_CLASS, 'flex items-center gap-1.5')}>
          <CheckIcon className="text-success" />
          {loginLabel}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className={DETAIL_TERM_CLASS}>Host</dt>
        <dd className={DETAIL_VALUE_CLASS}>{hostLabel}</dd>
      </div>
      <div className="min-w-0">
        <dt className={DETAIL_TERM_CLASS}>Scopes</dt>
        <dd className={DETAIL_VALUE_CLASS} title={scopesLabel}>
          {scopesLabel}
        </dd>
      </div>
    </dl>
  ) : null;

  const loadingBlock = isGhAuthStatusLoading ? (
    <p className="text-muted mt-4 flex items-center gap-2 text-sm">
      <Spinner size={SPINNER_SIZE.SM} label="Checking the gh CLI" />
      Running the gh preflight…
    </p>
  ) : null;

  return (
    <Card padding={CARD_PADDING.LG}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-ink text-sm font-semibold">GitHub CLI</h2>
          <p className="text-muted mt-1 text-xs leading-relaxed">
            Airlock reads every pull request through the gh CLI and stores no GitHub token of its
            own, so nothing works until gh is installed and signed in.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={statusTone}>{statusLabel}</Badge>
          <Button
            size={BUTTON_SIZE.SM}
            variant={BUTTON_VARIANT.SECONDARY}
            icon={<RefreshIcon />}
            isLoading={isGhAuthStatusLoading}
            onClick={onRecheckClick}
          >
            Re-check
          </Button>
        </div>
      </header>
      {loadingBlock}
      {authenticatedDetails}
      {problemBlock}
    </Card>
  );
}
