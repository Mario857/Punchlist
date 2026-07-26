import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { handleHeadMoved, handleNewComments } from './automation';
import { registerIpcHandlers } from './ipc';
import { applyProcessContainment } from './sandbox';
import { loadStore } from './store';
import { startWatcher, stopWatcher } from './watcher';
import { reconcileWorktrees } from './worktree';
import { prRefKey } from '@shared/discovery';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Airlock',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // Before anything can spawn a subprocess: agents inherit this process's
  // environment, so containment has to be in place first.
  applyProcessContainment();
  // The store resolves userData paths, so it cannot load before the app is ready.
  loadStore();
  registerIpcHandlers();
  createWindow();

  // The watcher reports; automation decides. Head movement is handled before the new
  // comments of the same poll, so its quiet period covers that batch.
  startWatcher({
    onHeadMoved: (ref) => handleHeadMoved(ref),
    onNewComments: (ref, comments) => {
      void handleNewComments(ref, comments);
    },
    onPollFailed: (ref, error) => {
      console.warn('[main] watch poll failed', prRefKey(ref), error.kind);
    },
  });

  // A crash or force-quit leaves worktrees registered with no live process, so the
  // sandbox is reconciled against persisted run state on every start. Deliberately
  // not the reverse: worktrees are never cleared on quit, because a ready or
  // needsDecision run must survive a restart.
  void reconcileWorktrees().catch((error: unknown) => {
    console.error('[main] worktree reconciliation failed', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  stopWatcher();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
