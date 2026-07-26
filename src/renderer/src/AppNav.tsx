import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { SettingsIcon } from '@renderer/components/icons/SettingsIcon';
import { joinClassNames } from '@renderer/lib/classNames';
import { SCREEN, type Screen } from './useApp';

interface Props {
  screen: Screen;
  onOpenWorkspace: () => void;
  onOpenSettings: () => void;
}

export function AppNav({ screen, onOpenWorkspace, onOpenSettings }: Props) {
  const isWorkspaceActive = screen === SCREEN.WORKSPACE;
  const workspaceVariant = isWorkspaceActive ? BUTTON_VARIANT.SECONDARY : BUTTON_VARIANT.GHOST;
  const settingsVariant = isWorkspaceActive ? BUTTON_VARIANT.GHOST : BUTTON_VARIANT.SECONDARY;

  return (
    <nav
      aria-label="Screens"
      className={joinClassNames(
        'flex items-center gap-2',
        'border-border border-b px-4 py-2',
        'bg-surface/40',
      )}
    >
      <span className="font-display text-ink mr-2 text-base tracking-tight">Airlock</span>
      <Button variant={workspaceVariant} size={BUTTON_SIZE.SM} onClick={onOpenWorkspace}>
        Workspace
      </Button>
      <Button
        variant={settingsVariant}
        size={BUTTON_SIZE.SM}
        icon={<SettingsIcon />}
        onClick={onOpenSettings}
      >
        Settings
      </Button>
    </nav>
  );
}
