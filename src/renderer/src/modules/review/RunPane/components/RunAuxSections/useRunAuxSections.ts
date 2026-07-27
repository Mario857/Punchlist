import { useCallback, useState } from 'react';

/** The secondary surfaces — everything that is not comment, diff, or decision. */
export const AUX_SECTION = {
  FOLLOW_UP: 'followUp',
  SECOND_OPINION: 'secondOpinion',
  REVISION_HISTORY: 'revisionHistory',
  FLAGS: 'flags',
  AUTO_DECISIONS: 'autoDecisions',
} as const;

export type AuxSection = (typeof AUX_SECTION)[keyof typeof AUX_SECTION];

export interface AuxSectionItem {
  section: AuxSection;
  label: string;
  isOpen: boolean;
  onClick: () => void;
}

export interface UseRunAuxSectionsParams {
  availableSections: readonly AuxSection[];
}

interface UseRunAuxSectionsResult {
  items: AuxSectionItem[];
  openSection: AuxSection | null;
}

const AUX_SECTION_LABEL: Record<AuxSection, string> = {
  [AUX_SECTION.FOLLOW_UP]: 'Ask for a change',
  [AUX_SECTION.SECOND_OPINION]: 'Second reading',
  [AUX_SECTION.REVISION_HISTORY]: 'Revision trail',
  [AUX_SECTION.FLAGS]: 'Flags',
  [AUX_SECTION.AUTO_DECISIONS]: 'Auto decisions',
};

/**
 * One surface at a time, and none by default: these are reached for occasionally, so
 * they cost a row of buttons rather than a stack of cards. Plain `useState` — which
 * detour is open is not worth remembering across selections, let alone restarts.
 */
export function useRunAuxSections({
  availableSections,
}: UseRunAuxSectionsParams): UseRunAuxSectionsResult {
  const [openSection, setOpenSection] = useState<AuxSection | null>(null);

  const onSectionClick = useCallback(
    (section: AuxSection) => setOpenSection((current) => (current === section ? null : section)),
    [],
  );

  const items = availableSections.map((section) => ({
    section,
    label: AUX_SECTION_LABEL[section],
    isOpen: openSection === section,
    onClick: () => onSectionClick(section),
  }));

  // A section can leave the list while open — a follow-up send flips the run to
  // revising — so the open surface is only honoured while it is still offered.
  const isOpenSectionAvailable = openSection !== null && availableSections.includes(openSection);

  return { items, openSection: isOpenSectionAvailable ? openSection : null };
}
