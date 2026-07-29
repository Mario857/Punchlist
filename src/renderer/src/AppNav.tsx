import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { SettingsIcon } from '@renderer/components/icons/SettingsIcon';
import { joinClassNames } from '@renderer/lib/classNames';
import { SCREEN, type Screen } from './useApp';

interface Props {
  screen: Screen;
  onOpenWorkspace: () => void;
  onOpenConventions: () => void;
  onOpenAudit: () => void;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
}

export function AppNav({
  screen,
  onOpenWorkspace,
  onOpenConventions,
  onOpenAudit,
  onOpenSettings,
  onOpenDebug,
}: Props) {
  const toVariant = (target: Screen) =>
    screen === target ? BUTTON_VARIANT.SECONDARY : BUTTON_VARIANT.GHOST;

  return (
    <nav
      aria-label="Screens"
      className={joinClassNames(
        'flex items-center gap-2',
        'border-border border-b px-4 py-2',
        'bg-surface/40',
      )}
    >
      <span className="font-display text-ink mr-2 text-base tracking-tight">Punchlist</span>
      <Button variant={toVariant(SCREEN.WORKSPACE)} size={BUTTON_SIZE.SM} onClick={onOpenWorkspace}>
        Workspace
      </Button>
      <Button
        variant={toVariant(SCREEN.CONVENTIONS)}
        size={BUTTON_SIZE.SM}
        onClick={onOpenConventions}
      >
        Conventions
      </Button>
      <Button variant={toVariant(SCREEN.AUDIT)} size={BUTTON_SIZE.SM} onClick={onOpenAudit}>
        Audit
      </Button>
      <Button variant={toVariant(SCREEN.DEBUG)} size={BUTTON_SIZE.SM} onClick={onOpenDebug}>
        Debug
      </Button>
      <Button
        variant={toVariant(SCREEN.SETTINGS)}
        size={BUTTON_SIZE.SM}
        icon={<SettingsIcon />}
        onClick={onOpenSettings}
      >
        Settings
      </Button>
    </nav>
  );
}
