import { SettingsIcon } from '@renderer/components/icons/SettingsIcon';
import { AutomationSettings } from '@renderer/modules/settings/AutomationSettings/AutomationSettings';
import { GeneralSettings } from '@renderer/modules/settings/GeneralSettings/GeneralSettings';
import { GhAuthStatusCard } from '@renderer/modules/settings/GhAuthStatusCard/GhAuthStatusCard';
import { RepoRegistry } from '@renderer/modules/settings/RepoRegistry/RepoRegistry';
import { TierModelMapping } from '@renderer/modules/settings/TierModelMapping/TierModelMapping';

/** Larger than the 16px body-text default because it sits beside the page title. */
const PAGE_ICON_SIZE = 20;

export function Settings() {
  return (
    <main className="font-body text-ink h-full overflow-y-auto p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-start gap-3">
          <SettingsIcon size={PAGE_ICON_SIZE} className="text-accent mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-wide">Settings</h1>
            <p className="text-muted mt-1 text-sm leading-relaxed">
              The preflight and the two things every run depends on: a working gh CLI, and a local
              clone of each repo you review.
            </p>
          </div>
        </header>
        <GhAuthStatusCard />
        <RepoRegistry />
        <GeneralSettings />
        <TierModelMapping />
        <AutomationSettings />
      </div>
    </main>
  );
}
