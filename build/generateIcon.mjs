import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Draws the app icon from scratch rather than committing a binary nobody can edit.
 * There is no SVG rasteriser on the toolchain, and adding one as a dependency to
 * produce a single asset would cost more than the fifty lines of geometry below.
 *
 * The mark is the architecture: a hatch split down the middle by a seam, because an
 * punchlist is a chamber with two doors that are never open at once. It has to survive
 * being 16 pixels wide in a dock, so it is one ring and one seam and nothing else.
 * The stroke and the seam are both deliberately heavy: at the first attempt the seam
 * was under a pixel at that size and the mark read as a plain circle, which is the
 * one reading it must not have.
 *
 * Run with `bun run icon`, which also builds the .icns.
 */
const CANVAS_SIZE = 1024;
/** Coverage is sampled on a grid per pixel; 4x4 is enough to hide the stair-stepping. */
const SUPERSAMPLE = 4;

const CORNER_RADIUS_RATIO = 0.2237; // macOS squircle-adjacent, measured off the grid
/** Two ruled lines and a check: a list, with its first item signed off. */
const CHECK_STROKE_RATIO = 0.105;
const CHECK_POINTS = [
  { x: 0.2, y: 0.345 },
  { x: 0.318, y: 0.462 },
  { x: 0.553, y: 0.226 },
];

const LINE_STROKE_RATIO = 0.086;
const LINE_START_X_RATIO = 0.2;
const LINE_END_X_RATIO = 0.8;
const LINE_Y_RATIOS = [0.63, 0.79];

const BACKGROUND_TOP = { red: 0x1c, green: 0x2a, blue: 0x3c };
const BACKGROUND_BOTTOM = { red: 0x0d, green: 0x12, blue: 0x18 };
const RING_COLOUR = { red: 0x5e, green: 0xc8, blue: 0xa0 };

const OPAQUE = 255;
const TRANSPARENT = 0;
const CHANNELS = 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOUR_TYPE_RGBA = 6;
const NO_FILTER = 0;

function mix(from, to, amount) {
  return Math.round(from + (to - from) * amount);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/** Signed distance to a rounded rectangle centred on the canvas; negative is inside. */
function roundedRectDistance(x, y, halfSize, radius) {
  const dx = Math.abs(x - halfSize) - (halfSize - radius);
  const dy = Math.abs(y - halfSize) - (halfSize - radius);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  return Math.hypot(outsideX, outsideY) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Distance from a point to a line segment, which is what gives the check its stroke. */
function segmentDistance(x, y, from, to) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const projected = ((x - from.x) * deltaX + (y - from.y) * deltaY) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, projected));
  return Math.hypot(x - (from.x + clamped * deltaX), y - (from.y + clamped * deltaY));
}

function isInsideMark(x, y, geometry) {
  const { checkPoints, checkHalfStroke, lines, lineHalfStroke } = geometry;

  for (let index = 0; index + 1 < checkPoints.length; index += 1) {
    if (segmentDistance(x, y, checkPoints[index], checkPoints[index + 1]) <= checkHalfStroke) {
      return true;
    }
  }

  for (const line of lines) {
    if (segmentDistance(x, y, line.from, line.to) <= lineHalfStroke) return true;
  }
  return false;
}

function renderPixels() {
  const halfSize = CANVAS_SIZE / 2;
  const geometry = {
    checkPoints: CHECK_POINTS.map((point) => ({
      x: CANVAS_SIZE * point.x,
      y: CANVAS_SIZE * point.y,
    })),
    checkHalfStroke: (CANVAS_SIZE * CHECK_STROKE_RATIO) / 2,
    lines: LINE_Y_RATIOS.map((yRatio) => ({
      from: { x: CANVAS_SIZE * LINE_START_X_RATIO, y: CANVAS_SIZE * yRatio },
      to: { x: CANVAS_SIZE * LINE_END_X_RATIO, y: CANVAS_SIZE * yRatio },
    })),
    lineHalfStroke: (CANVAS_SIZE * LINE_STROKE_RATIO) / 2,
  };
  const cornerRadius = CANVAS_SIZE * CORNER_RADIUS_RATIO;
  const pixels = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE * CHANNELS);
  const sampleStep = 1 / SUPERSAMPLE;
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE;

  for (let row = 0; row < CANVAS_SIZE; row += 1) {
    for (let column = 0; column < CANVAS_SIZE; column += 1) {
      let insideTile = 0;
      let insideMark = 0;

      for (let sampleY = 0; sampleY < SUPERSAMPLE; sampleY += 1) {
        for (let sampleX = 0; sampleX < SUPERSAMPLE; sampleX += 1) {
          const x = column + (sampleX + 0.5) * sampleStep;
          const y = row + (sampleY + 0.5) * sampleStep;
          if (roundedRectDistance(x, y, halfSize, cornerRadius) < 0) insideTile += 1;
          if (isInsideMark(x, y, geometry)) insideMark += 1;
        }
      }

      const tileCoverage = insideTile / samplesPerPixel;
      const markCoverage = (insideMark / samplesPerPixel) * tileCoverage;
      const verticalPosition = clamp01(row / (CANVAS_SIZE - 1));

      const backgroundRed = mix(BACKGROUND_TOP.red, BACKGROUND_BOTTOM.red, verticalPosition);
      const backgroundGreen = mix(BACKGROUND_TOP.green, BACKGROUND_BOTTOM.green, verticalPosition);
      const backgroundBlue = mix(BACKGROUND_TOP.blue, BACKGROUND_BOTTOM.blue, verticalPosition);

      const offset = (row * CANVAS_SIZE + column) * CHANNELS;
      pixels[offset] = mix(backgroundRed, RING_COLOUR.red, markCoverage);
      pixels[offset + 1] = mix(backgroundGreen, RING_COLOUR.green, markCoverage);
      pixels[offset + 2] = mix(backgroundBlue, RING_COLOUR.blue, markCoverage);
      pixels[offset + 3] = tileCoverage > 0 ? Math.round(tileCoverage * OPAQUE) : TRANSPARENT;
    }
  }

  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

function encodePng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(CANVAS_SIZE, 0);
  header.writeUInt32BE(CANVAS_SIZE, 4);
  header[8] = BIT_DEPTH;
  header[9] = COLOUR_TYPE_RGBA;

  const stride = CANVAS_SIZE * CHANNELS;
  const raw = Buffer.alloc((stride + 1) * CANVAS_SIZE);
  for (let row = 0; row < CANVAS_SIZE; row += 1) {
    raw[row * (stride + 1)] = NO_FILTER;
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputDirectory = dirname(fileURLToPath(import.meta.url));
mkdirSync(outputDirectory, { recursive: true });
const outputPath = join(outputDirectory, 'icon.png');
writeFileSync(outputPath, encodePng(renderPixels()));
process.stdout.write(`${outputPath}\n`);
