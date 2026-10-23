import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

import { isJpeg, stripJpegMetadata, toBase64 } from '../supabase/functions/_shared/jpeg.ts';

const seg = (marker, payload) => {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
};
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// SOI, APP0 (JFIF), APP1 (EXIF with "GPS"), COM, DQT, SOS + data, EOI
const jpeg = Uint8Array.from([
  0xff, 0xd8,
  ...seg(0xe0, ascii('JFIF\0')),
  ...seg(0xe1, ascii('Exif\0\0GPS 40.7128N 74.0060W iPhone')),
  ...seg(0xfe, ascii('taken at home')),
  ...seg(0xdb, [0, 1, 2, 3]),
  0xff, 0xda, 0, 2, 9, 9, 9,
  0xff, 0xd9,
]);

test('strips EXIF, comments and other metadata but keeps the image', () => {
  const out = stripJpegMetadata(jpeg);
  const text = String.fromCharCode(...out);
  assert.ok(!text.includes('GPS'));
  assert.ok(!text.includes('iPhone'));
  assert.ok(!text.includes('taken at home'));
  assert.ok(text.includes('JFIF'));
  assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
  assert.ok(isJpeg(out));
});

test('rejects things that are not JPEGs', () => {
  assert.throws(() => stripJpegMetadata(Uint8Array.from(ascii('\x89PNG....'))), /Not a JPEG/);
  assert.throws(() => stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x50, 1])), /Malformed/);
});

test('toBase64 matches Node', () => {
  const bytes = Uint8Array.from({ length: 100000 }, (_, i) => i % 256);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
});
