import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { installApplicationMenu } from './appMenu';
import { handleHeadMoved, handleNewComments } from './automation';
import { registerIpcHandlers } from './ipc';
import { applyProcessContainment } from './sandbox';
import { loadStore } from './store';
import { startWatcher, stopWatcher } from './watcher';
import {
  MINIMUM_WINDOW_HEIGHT,
  MINIMUM_WINDOW_WIDTH,
  resolveInitialWindowBounds,
  trackWindowState,
} from './windowState';
import { reconcileWorktrees } from './worktree';
import { prRefKey } from '@shared/discovery';

const MAIN_LOG_SCOPE = '[main]';

/** Held so a second launch has something to focus instead of opening its own window. */
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const appWindow = new BrowserWindow({
    // Restored from the last session and clamped onto a display that still exists.
    ...resolveInitialWindowBounds(),
    minWidth: MINIMUM_WINDOW_WIDTH,
    minHeight: MINIMUM_WINDOW_HEIGHT,
    show: false,
    title: 'Airlock',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = appWindow;

  trackWindowState(appWindow);

  appWindow.on('ready-to-show', () => {
    appWindow.show();
  });

  appWindow.on('closed', () => {
    mainWindow = null;
  });

  appWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    appWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    appWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function focusMainWindow(): void {
  const existingWindow = mainWindow;
  if (existingWindow === null) return;

  if (existingWindow.isMinimized()) existingWindow.restore();
  existingWindow.show();
  existingWindow.focus();
}

/**
 * An unhandled rejection is silent by default and an uncaught exception ends the
 * process with nothing to read afterwards — in a long-lived desktop app both look
 * like the window simply vanished. Neither is fatal here: run records are persisted
 * on every state transition and worktrees are reconciled on the next start, so
 * staying up with the failure on the record beats disappearing.
 *
 * Console only, like every other error path in this app: an error value can quote
 * agent output or repository contents, so it never reaches a log file.
 */
function registerProcessErrorHandlers(): void {
  process.on('uncaughtException', (error: unknown) => {
    console.error(MAIN_LOG_SCOPE, 'uncaught exception', error);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    console.error(MAIN_LOG_SCOPE, 'unhandled rejection', reason);
  });
}

function bootstrap(): void {
  app.whenReady().then(() => {
    // Before anything can spawn a subprocess: agents inherit this process's
    // environment, so containment has to be in place first.
    applyProcessContainment();
    // The store resolves userData paths, so it cannot load before the app is ready.
    loadStore();
    registerIpcHandlers();
    installApplicationMenu();
    createWindow();

    // The watcher reports; automation decides. Head movement is handled before the new
    // comments of the same poll, so its quiet period covers that batch.
    startWatcher({
      onHeadMoved: (ref) => handleHeadMoved(ref),
      onNewComments: (ref, comments) => {
        void handleNewComments(ref, comments);
      },
      onPollFailed: (ref, error) => {
        console.warn(MAIN_LOG_SCOPE, 'watch poll failed', prRefKey(ref), error.kind);
      },
    });

    // A crash or force-quit leaves worktrees registered with no live process, so the
    // sandbox is reconciled against persisted run state on every start. Deliberately
    // not the reverse: worktrees are never cleared on quit, because a ready or
    // needsDecision run must survive a restart.
    void reconcileWorktrees().catch((error: unknown) => {
      console.error(MAIN_LOG_SCOPE, 'worktree reconciliation failed', error);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  // A second launch hands its intent to the running instance rather than starting up.
  app.on('second-instance', () => {
    focusMainWindow();
  });

  app.on('will-quit', () => {
    stopWatcher();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

registerProcessErrorHandlers();

/**
 * State is one JSON file and one set of git worktrees. Two Airlock processes would
 * both write `airlock-state.json` — last writer wins, silently — and both would
 * believe they own the same sandbox directories. That is corruption rather than a
 * rough edge, so the lock is taken before anything that reads or writes either:
 * the loser quits without loading the store or creating a window.
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  bootstrap();
} else {
  app.quit();
}
