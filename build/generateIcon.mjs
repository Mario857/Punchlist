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
 * airlock is a chamber with two doors that are never open at once. It has to survive
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
const RING_RADIUS_RATIO = 0.275;
const RING_STROKE_RATIO = 0.125;
const SEAM_HALF_WIDTH_RATIO = 0.068;

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

function isInsideMark(x, y, geometry) {
  const { centre, ringRadius, ringHalfStroke, seamHalfWidth } = geometry;
  const distanceToRing = Math.abs(Math.hypot(x - centre, y - centre) - ringRadius);
  if (distanceToRing > ringHalfStroke) return false;
  // The seam is what makes it a hatch rather than a plain circle: two facing doors.
  return Math.abs(x - centre) > seamHalfWidth;
}

function renderPixels() {
  const halfSize = CANVAS_SIZE / 2;
  const geometry = {
    centre: halfSize,
    ringRadius: CANVAS_SIZE * RING_RADIUS_RATIO,
    ringHalfStroke: (CANVAS_SIZE * RING_STROKE_RATIO) / 2,
    seamHalfWidth: CANVAS_SIZE * SEAM_HALF_WIDTH_RATIO,
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
