import { useCallback } from 'react';
import { useSessionStore } from '@renderer/stores/sessionStore';

export interface UseCollapsibleCardParams {
  sectionId: string;
  isDefaultOpen: boolean;
}

interface UseCollapsibleCardResult {
  isOpen: boolean;
  onToggleClick: () => void;
  /** Ties the header button to the region it controls, which is what makes it a disclosure. */
  bodyId: string;
}

const BODY_ID_SUFFIX = '-body';

/**
 * Open state is persisted per section rather than per run: which parts of the review a
 * given person wants in front of them is a working habit, not a property of one patch,
 * and re-collapsing four cards on every comment would be worse than not offering it.
 *
 * The store holds only sections that have been toggled, so a section that has never
 * been touched follows its own default and a later change to that default reaches
 * everyone who never disagreed with it.
 */
export function useCollapsibleCard({
  sectionId,
  isDefaultOpen,
}: UseCollapsibleCardParams): UseCollapsibleCardResult {
  const sectionOpenById = useSessionStore((state) => state.sectionOpenById);
  const setSectionOpen = useSessionStore((state) => state.setSectionOpen);

  const isOpen = sectionOpenById[sectionId] ?? isDefaultOpen;

  const onToggleClick = useCallback(
    () => setSectionOpen(sectionId, !isOpen),
    [sectionId, isOpen, setSectionOpen],
  );

  return { isOpen, onToggleClick, bodyId: `${sectionId}${BODY_ID_SUFFIX}` };
}
