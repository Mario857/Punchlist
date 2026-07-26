import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';

/**
 * The right pane becomes the state-dependent review surface — decision prompt,
 * editable diff, transcript — once runs exist. Phase 1 has no agents and no
 * worktrees, so it says so plainly rather than showing an empty diff viewer that
 * implies something is still loading.
 */
export function ResolutionPane() {
  return (
    <div className="grid h-full place-items-center p-6">
      <Card tone={CARD_TONE.RAISED} padding={CARD_PADDING.LG} className="max-w-sm text-center">
        <h2 className="text-ink mb-2 text-sm font-semibold">Resolution comes next</h2>
        <p className="text-muted text-sm leading-relaxed">
          Selecting comments and running agents in isolated worktrees arrives in phase 2. For now
          this is a read-only triage view over every comment on the pull request.
        </p>
      </Card>
    </div>
  );
}
