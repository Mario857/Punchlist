import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, screen, type BrowserWindow, type Rectangle } from 'electron';
import { z } from 'zod';

/**
 * Geometry lives in its own file rather than a section of `airlock-state.json`:
 * it is rewritten on every resize and move, and sharing the state file would mean
 * serialising every run record and transcript on each drag of the window frame.
 *
 * It follows the same discipline as `store.ts` regardless — Zod-parsed because the
 * file may have been written by an older version, every field defaulted so a
 * partial file widens instead of needing migration code, and written through a
 * temp file so a crash mid-write cannot leave a truncated one behind.
 */
const WINDOW_STATE_FILE_NAME = 'airlock-window-state.json';
const TEMP_FILE_SUFFIX = '.tmp';
const FILE_ENCODING = 'utf8';
const JSON_INDENT_SPACES = 2;

const WINDOW_STATE_LOG_SCOPE = '[windowState]';

const DEFAULT_WINDOW_WIDTH = 1200;
const DEFAULT_WINDOW_HEIGHT = 800;

/** Below this the three-pane workspace stops being usable rather than merely cramped. */
export const MINIMUM_WINDOW_WIDTH = 800;
export const MINIMUM_WINDOW_HEIGHT = 600;

/** How much of the frame has to overlap a live display for a saved position to be reusable. */
const MINIMUM_VISIBLE_OVERLAP_PX = 64;

/** `resize` and `move` fire per frame while dragging, so the write is trailing-edge only. */
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 400;

const CENTRE_DIVISOR = 2;

const windowStateSchema = z.object({
  width: z.number().int().positive().default(DEFAULT_WINDOW_WIDTH),
  height: z.number().int().positive().default(DEFAULT_WINDOW_HEIGHT),
  /** Null until the window has been placed once; Electron centres it in the meantime. */
  x: z.number().int().nullable().default(null),
  y: z.number().int().nullable().default(null),
});

type PersistedWindowState = z.infer<typeof windowStateSchema>;

const DEFAULT_WINDOW_STATE: PersistedWindowState = windowStateSchema.parse({});

/**
 * Shaped for `BrowserWindowConstructorOptions`, which is why the position is
 * optional rather than nullable: omitting it is how Electron is told to centre the
 * window, and there is no null it accepts for that.
 */
export interface InitialWindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

interface WindowSize {
  width: number;
  height: number;
}

/**
 * The renderer's `clamp` lives in `lib/numbers.ts`, which main may not import
 * across the process boundary, and `src/shared/` has no numeric helper to hold it.
 */
function clampToRange(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function resolveWindowStateFilePath(): string {
  return join(app.getPath('userData'), WINDOW_STATE_FILE_NAME);
}

function readPersistedWindowState(): PersistedWindowState {
  const filePath = resolveWindowStateFilePath();
  if (!existsSync(filePath)) return DEFAULT_WINDOW_STATE;

  const decoded = ((): unknown => {
    try {
      return JSON.parse(readFileSync(filePath, FILE_ENCODING));
    } catch (error: unknown) {
      console.warn(WINDOW_STATE_LOG_SCOPE, 'Window state could not be read as JSON.', error);
      return undefined;
    }
  })();

  const parsed = windowStateSchema.safeParse(decoded);
  if (!parsed.success) {
    console.warn(WINDOW_STATE_LOG_SCOPE, 'Window state has an unexpected shape; using defaults.');
    return DEFAULT_WINDOW_STATE;
  }

  return parsed.data;
}

function writePersistedWindowState(next: PersistedWindowState): void {
  const filePath = resolveWindowStateFilePath();
  try {
    // rename is atomic within a directory, so an interrupted write leaves the
    // previous geometry intact rather than a file that fails to parse on next boot.
    const tempPath = `${filePath}${TEMP_FILE_SUFFIX}`;
    writeFileSync(tempPath, JSON.stringify(next, null, JSON_INDENT_SPACES));
    renameSync(tempPath, filePath);
  } catch (error: unknown) {
    // Losing the window position is not worth taking down a window event handler for.
    console.warn(WINDOW_STATE_LOG_SCOPE, 'Window state could not be written.', error);
  }
}

/** True when enough of the rect lands on a display that is currently connected. */
function hasVisibleOverlap(rect: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const { workArea } = display;
    const overlapWidth =
      Math.min(rect.x + rect.width, workArea.x + workArea.width) - Math.max(rect.x, workArea.x);
    const overlapHeight =
      Math.min(rect.y + rect.height, workArea.y + workArea.height) - Math.max(rect.y, workArea.y);
    return (
      overlapWidth >= MINIMUM_VISIBLE_OVERLAP_PX && overlapHeight >= MINIMUM_VISIBLE_OVERLAP_PX
    );
  });
}

function resolveSize(saved: PersistedWindowState, workArea: Rectangle): WindowSize {
  return {
    width: clampToRange(saved.width, MINIMUM_WINDOW_WIDTH, workArea.width),
    height: clampToRange(saved.height, MINIMUM_WINDOW_HEIGHT, workArea.height),
  };
}

function centreOn(workArea: Rectangle, size: WindowSize): InitialWindowBounds {
  return {
    ...size,
    x: workArea.x + Math.round((workArea.width - size.width) / CENTRE_DIVISOR),
    y: workArea.y + Math.round((workArea.height - size.height) / CENTRE_DIVISOR),
  };
}

/**
 * The saved geometry, clamped back onto hardware that exists. A window restored onto
 * a monitor that has since been unplugged opens at coordinates no display covers,
 * which is the classic way to lose an app off-screen with no way to drag it back —
 * so a position with no live display under it is re-centred instead of honoured, and
 * a size larger than the display it lands on is trimmed to fit.
 *
 * Must be called after `app.whenReady()`: the `screen` module is unavailable before it.
 */
export function resolveInitialWindowBounds(): InitialWindowBounds {
  const saved = readPersistedWindowState();

  if (saved.x === null || saved.y === null) {
    return resolveSize(saved, screen.getPrimaryDisplay().workArea);
  }

  const savedRect: Rectangle = {
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
  };
  // getDisplayMatching returns the display the rect overlaps most, and the nearest
  // live one when the display it was saved on is gone.
  const { workArea } = screen.getDisplayMatching(savedRect);
  const size = resolveSize(saved, workArea);

  if (!hasVisibleOverlap({ ...savedRect, ...size })) return centreOn(workArea, size);

  return { ...size, x: saved.x, y: saved.y };
}

/** Persists size and position for the next launch. Attach once, at window creation. */
export function trackWindowState(window: BrowserWindow): void {
  let saveTimer: NodeJS.Timeout | null = null;

  const save = (): void => {
    // getNormalBounds rather than getBounds: a maximized or full-screened window
    // would otherwise persist the screen-filling rect as its restored size, and
    // un-maximizing after the next launch would have nothing to go back to.
    const bounds = window.getNormalBounds();
    writePersistedWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    });
  };

  const scheduleSave = (): void => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, WINDOW_STATE_SAVE_DEBOUNCE_MS);
  };

  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('close', () => {
    // Teardown would cancel a pending debounce, so the final geometry — the one the
    // user actually left the app in — is flushed synchronously here.
    if (saveTimer !== null) clearTimeout(saveTimer);
    save();
  });
}
