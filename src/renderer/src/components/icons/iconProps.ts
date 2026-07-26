/**
 * Every icon in the app shares this contract: a numeric `size` in px, `className`
 * for colour, and decorative-by-default semantics. Icons draw with `currentColor`
 * so a Tailwind text utility on the icon or any ancestor colours them.
 */
export interface IconProps {
  size?: number;
  className?: string;
  /**
   * Icons sit inside labelled controls (Button, IconButton, TreeRow), so they are
   * hidden from assistive tech unless a caller opts them into the accessibility tree.
   */
  isAriaHidden?: boolean;
}

/** 16px matches the base 14–16px UI text, so icons align on the text baseline grid. */
export const ICON_SIZE = 16;

/** All icon geometry is authored on a 16×16 grid and scales via `size`. */
export const ICON_VIEW_BOX = '0 0 16 16';
