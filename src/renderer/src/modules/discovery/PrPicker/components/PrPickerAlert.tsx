import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';

export interface PrPickerAlertProps {
  message: string;
  /** The exact command or step that fixes it, when the failure kind has one. */
  remediation: string | null;
}

const ALERT_ICON_SIZE = 14;

/**
 * Renders a typed failure without collapsing its remediation: "gh is not installed"
 * and "your token expired" reach here as different messages and must stay different.
 */
export function PrPickerAlert({ message, remediation }: PrPickerAlertProps) {
  const remediationLine =
    remediation === null ? null : <p className="text-muted text-xs">{remediation}</p>;

  return (
    <Card padding={CARD_PADDING.SM} tone={CARD_TONE.RAISED}>
      <div role="alert" className="flex items-start gap-2">
        <AlertTriangleIcon size={ALERT_ICON_SIZE} className="text-danger mt-0.5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-ink text-sm leading-snug">{message}</p>
          {remediationLine}
        </div>
      </div>
    </Card>
  );
}
