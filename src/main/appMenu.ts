import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import {
  MAXIMUM_ZOOM_LEVEL,
  MINIMUM_ZOOM_LEVEL,
  ZOOM_LEVEL_STEP,
  persistZoomLevel,
  readPersistedZoomLevel,
} from './windowState';

const MACOS_PLATFORM = 'darwin';

const RESET_ZOOM_LEVEL = 0;

function clampZoomLevel(level: number): number {
  return Math.min(Math.max(level, MINIMUM_ZOOM_LEVEL), MAXIMUM_ZOOM_LEVEL);
}

/**
 * The zoom items are written out rather than taken from the `viewMenu` role, because
 * the role's versions change the web contents and forget: the level is gone on the next
 * launch. Zoom is how you make a dense diff readable on a particular monitor, so it has
 * to survive a restart to be worth anything.
 */
function applyZoomLevel(level: number): void {
  const window = BrowserWindow.getFocusedWindow();
  if (window === null) return;
  const clamped = clampZoomLevel(level);
  window.webContents.setZoomLevel(clamped);
  persistZoomLevel(clamped);
}

function buildZoomItems(): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Zoom In',
      accelerator: 'CmdOrCtrl+Plus',
      click: () => applyZoomLevel(readPersistedZoomLevel() + ZOOM_LEVEL_STEP),
    },
    {
      label: 'Zoom Out',
      accelerator: 'CmdOrCtrl+-',
      click: () => applyZoomLevel(readPersistedZoomLevel() - ZOOM_LEVEL_STEP),
    },
    {
      label: 'Actual Size',
      accelerator: 'CmdOrCtrl+0',
      click: () => applyZoomLevel(RESET_ZOOM_LEVEL),
    },
  ];
}

/** Applied once the contents exist; a zoom level set before that does not stick. */
export function applyPersistedZoomLevel(window: BrowserWindow): void {
  window.webContents.setZoomLevel(clampZoomLevel(readPersistedZoomLevel()));
}

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
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        ...buildZoomItems(),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // Minimize, Zoom, Close.
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
