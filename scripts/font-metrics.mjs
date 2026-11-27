// Reads a WOFF2 file directly (no font library) and reports the axes and the
// metrics needed to build a fallback @font-face with size-adjust overrides.
//
//   node scripts/font-metrics.mjs node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wdth-normal.woff2
//
// WOFF2 layout: a 48-byte header, a table directory with UIntBase128 lengths,
// then one Brotli stream holding every table back to back. glyf/loca are
// transformed (and so have a second length in the directory); the rest are
// stored as-is, which is all head/hhea/OS-2/fvar need.

import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill'
];

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/font-metrics.mjs <file.woff2>');
const buf = readFileSync(file);
if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`${file} is not a WOFF2 file`);

const readBase128 = (at) => {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf[at.offset + i];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) {
      at.offset += i + 1;
      return value;
    }
  }
  throw new Error('Malformed UIntBase128');
};

const numTables = buf.readUInt16BE(12);
let at = { offset: 48 };
const tables = {};
const order = [];
for (let i = 0; i < numTables; i += 1) {
  const flags = buf[at.offset];
  at.offset += 1;
  const tagIndex = flags & 0x3f;
  const transform = (flags >> 6) & 0x3;
  let tag;
  if (tagIndex === 63) {
    tag = buf.toString('latin1', at.offset, at.offset + 4);
    at.offset += 4;
  } else {
    tag = KNOWN_TAGS[tagIndex];
  }
  const origLength = readBase128(at);
  const transformed = (tag === 'glyf' || tag === 'loca') && transform === 0;
  const length = transformed ? readBase128(at) : origLength;
  tables[tag] = length;
  order.push([tag, length]);
}

const data = brotliDecompressSync(buf.subarray(at.offset, at.offset + buf.readUInt32BE(20)));
const slice = {};
let cursor = 0;
for (const [tag, length] of order) {
  slice[tag] = data.subarray(cursor, cursor + length);
  cursor += length;
}

const upm = slice.head.readUInt16BE(18);
const ascender = slice.hhea.readInt16BE(4);
const descender = slice.hhea.readInt16BE(6);
const lineGap = slice.hhea.readInt16BE(8);
const avgWidth = slice['OS/2'].readInt16BE(2);

const axes = [];
if (slice.fvar) {
  const axisCount = slice.fvar.readUInt16BE(8);
  const axisSize = slice.fvar.readUInt16BE(10);
  const axesOffset = slice.fvar.readUInt16BE(4);
  const fixed = (off) => slice.fvar.readInt32BE(off) / 65536;
  for (let i = 0; i < axisCount; i += 1) {
    const base = axesOffset + i * axisSize;
    axes.push({
      tag: slice.fvar.toString('latin1', base, base + 4),
      min: fixed(base + 4),
      default: fixed(base + 8),
      max: fixed(base + 12)
    });
  }
}

// Fallback numbers for Arial/Helvetica, the metrically closest local face on
// phones and desktops. Next.js's fallback-metric algorithm, in the same order.
const FALLBACK = { upm: 2048, ascender: 1854, descender: -434, lineGap: 67, avgWidth: 904 };
// size-adjust scales the local fallback so a line of it is as wide as the same
// line in the webfont; the ascent/descent overrides are then divided by it so
// the fallback's line box keeps the webfont's height at that scale.
// An estimate only. This font reports an OS/2 xAvgCharWidth (548/1000) wider
// than its glyphs actually measure, so the real size-adjust was measured in a
// browser against the fallback face (107.02%); see src/font.css. The ascent
// and descent numbers below are exact.
const sizeAdjust = avgWidth / upm / (FALLBACK.avgWidth / FALLBACK.upm);
const percent = (n) => `${(n * 100).toFixed(2)}%`;

console.log(
  JSON.stringify(
    {
      file,
      upm,
      ascender,
      descender,
      lineGap,
      avgWidth,
      axes,
      overrides: {
        'size-adjust': percent(sizeAdjust),
        'ascent-override': percent(ascender / upm / sizeAdjust),
        'descent-override': percent(-descender / upm / sizeAdjust),
        'line-gap-override': percent(lineGap / upm / sizeAdjust)
      }
    },
    null,
    2
  )
);
