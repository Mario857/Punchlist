import { Menu, type MenuItemConstructorOptions } from 'electron';

const MACOS_PLATFORM = 'darwin';

/**
 * The Edit menu is not chrome. On macOS, Cmd+C/V/X/A and Cmd+Z are delivered
 * through menu accelerators rather than by the web contents, so a packaged build
 * without this menu has no working clipboard in *any* text field in the app — the
 * decision reply, the follow-up prompt, the inline prompt, the PR URL field, the
 * target branch, the commit message. It reads as polish and behaves as a bug.
 *
 * Built from Electron's composite roles rather than hand-written accelerators:
 * each role carries the platform's own key bindings, labels and localisation, and
 * stays correct when those conventions change.
 */
export function installApplicationMenu(): void {
  const isMacOs = process.platform === MACOS_PLATFORM;

  // 'appMenu' is macOS-only — About, Services, Hide and Quit have no equivalent
  // section elsewhere — so it is omitted rather than rendered as an empty menu.
  const appMenuSection: MenuItemConstructorOptions[] = isMacOs ? [{ role: 'appMenu' }] : [];

  // Quit lives in the app menu on macOS; on Windows and Linux the File menu is the
  // only place it exists, so leaving it out there would leave no way to quit.
  const fileMenuSection: MenuItemConstructorOptions[] = isMacOs ? [] : [{ role: 'fileMenu' }];

  const template: MenuItemConstructorOptions[] = [
    ...appMenuSection,
    ...fileMenuSection,
    // Undo/Redo, Cut/Copy/Paste, Select All.
    { role: 'editMenu' },
    // Reload, Toggle Developer Tools, the zoom levels, and full screen.
    { role: 'viewMenu' },
    // Minimize, Zoom, Close.
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
