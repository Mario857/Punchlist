import { ConventionExport } from '@renderer/modules/conventions/ConventionExport/ConventionExport';
import { ConventionList } from '@renderer/modules/conventions/ConventionList/ConventionList';

/**
 * Its own screen rather than a card inside Settings: the distilled corpus is the reusable
 * product of everything Punchlist has read, not a preference. The list comes first and the
 * export gate last, because confirming rules is what makes an export worth doing.
 */
export function Conventions() {
  return (
    <main className="font-body text-ink h-full overflow-y-auto p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="min-w-0">
          <h1 className="text-lg font-semibold tracking-wide">Conventions</h1>
          <p className="text-muted mt-1 text-sm leading-relaxed">
            What your reviewers keep asking for, distilled into rules you can hand to the next
            coding agent. Nothing here reaches a repository until you confirm an export.
          </p>
        </header>
        <ConventionList />
        <ConventionExport />
      </div>
    </main>
  );
}
