import { Button, BUTTON_SIZE, BUTTON_VARIANT } from '@renderer/components/Button';
import { assertNever } from '@renderer/lib/assertNever';
import { AutoDecisions } from '@renderer/modules/review/AutoDecisions/AutoDecisions';
import { FollowUpPrompt } from '@renderer/modules/review/FollowUpPrompt/FollowUpPrompt';
import { GuardrailFlags } from '@renderer/modules/review/GuardrailFlags/GuardrailFlags';
import { RevisionHistory } from '@renderer/modules/review/RevisionHistory/RevisionHistory';
import { SecondOpinion } from '@renderer/modules/review/SecondOpinion/SecondOpinion';
import {
  AUX_SECTION,
  useRunAuxSections,
  type AuxSection,
} from '@renderer/modules/review/RunPane/components/RunAuxSections/useRunAuxSections';

export interface RunAuxSectionsProps {
  runId: string;
  availableSections: readonly AuxSection[];
}

const ROW_LABEL = 'More review surfaces';
const ROW_CLASS = 'flex flex-wrap items-center gap-1';

/**
 * The occasional surfaces behind one row of toggles, so the pane's spine stays
 * comment → diff → decision. Opening one closes the last: these are detours, and two
 * detours at once is a scroll problem wearing a different hat.
 */
export function RunAuxSections({ runId, availableSections }: RunAuxSectionsProps) {
  const { items, openSection } = useRunAuxSections({ runId, availableSections });

  const buttons = items.map((item) => (
    <Button
      key={item.section}
      variant={item.isOpen ? BUTTON_VARIANT.SECONDARY : BUTTON_VARIANT.GHOST}
      size={BUTTON_SIZE.SM}
      isPressed={item.isOpen}
      onClick={item.onClick}
    >
      {item.label}
    </Button>
  ));

  const surface = (() => {
    if (openSection === null) return null;
    switch (openSection) {
      case AUX_SECTION.FOLLOW_UP:
        return <FollowUpPrompt runId={runId} />;
      case AUX_SECTION.SECOND_OPINION:
        return <SecondOpinion runId={runId} />;
      case AUX_SECTION.REVISION_HISTORY:
        return <RevisionHistory runId={runId} />;
      case AUX_SECTION.FLAGS:
        return <GuardrailFlags runId={runId} />;
      case AUX_SECTION.AUTO_DECISIONS:
        return <AutoDecisions runId={runId} />;
      default:
        return assertNever(openSection);
    }
  })();

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={ROW_LABEL} className={ROW_CLASS}>
        {buttons}
      </div>
      {surface}
    </div>
  );
}
