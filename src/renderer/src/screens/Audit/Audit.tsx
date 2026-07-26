import { AuditLog } from '@renderer/modules/audit/AuditLog/AuditLog';

/**
 * Its own screen rather than a card inside Settings: this is a record, not a
 * preference, and it is the surface someone opens to answer "what has this tool
 * actually done to my repository".
 */
export function Audit() {
  return (
    <main className="font-body text-ink h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        <AuditLog />
      </div>
    </main>
  );
}
