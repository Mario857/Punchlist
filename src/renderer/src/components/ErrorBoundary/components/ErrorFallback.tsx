import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { RefreshIcon } from '@renderer/components/icons/RefreshIcon';
import { FOCUS_RING } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';

interface Props {
  message: string;
  onReloadClick: () => void;
}

const HEADING = 'The interface stopped rendering';
const EXPLANATION =
  'Nothing was lost. Runs, worktrees and the audit log live in the main process, so reloading the window restores the screen you were on.';
const DETAILS_LABEL = 'Error details';
const RELOAD_LABEL = 'Reload the window';

const LAYOUT_CLASS = 'font-body text-ink grid h-full place-items-center p-6';
const CARD_CLASS = 'max-w-lg';
const HEADER_CLASS = 'flex items-center gap-2';
const ICON_CLASS = 'text-danger shrink-0';
const HEADING_CLASS = 'font-display text-ink text-lg tracking-tight';
const EXPLANATION_CLASS = 'text-muted mt-3 text-sm leading-relaxed';
const DETAILS_CLASS = 'mt-4';
const SUMMARY_CLASS = 'text-muted cursor-pointer text-xs select-none';
const MESSAGE_CLASS = 'text-muted mt-2 font-mono text-xs break-words';
const BUTTON_CLASS = 'mt-5';

/**
 * The recoverable face of a render crash. The message sits behind a disclosure
 * rather than in the heading: an error string in this app can carry agent
 * transcript or repository content, and the same discipline applies here as
 * everywhere else that renders one.
 */
export function ErrorFallback({ message, onReloadClick }: Props) {
  return (
    <div className={LAYOUT_CLASS}>
      <Card padding={CARD_PADDING.LG} tone={CARD_TONE.RAISED} className={CARD_CLASS}>
        <div className={HEADER_CLASS}>
          <AlertTriangleIcon className={ICON_CLASS} />
          <h1 className={HEADING_CLASS}>{HEADING}</h1>
        </div>
        <p className={EXPLANATION_CLASS}>{EXPLANATION}</p>
        <details className={DETAILS_CLASS}>
          <summary className={joinClassNames(SUMMARY_CLASS, FOCUS_RING)}>{DETAILS_LABEL}</summary>
          <p className={MESSAGE_CLASS}>{message}</p>
        </details>
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          size={BUTTON_SIZE.MD}
          icon={<RefreshIcon />}
          onClick={onReloadClick}
          className={BUTTON_CLASS}
        >
          {RELOAD_LABEL}
        </Button>
      </Card>
    </div>
  );
}
