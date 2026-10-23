// JPEG helpers for photo uploads. The app re-encodes photos before uploading,
// but the server never trusts that: it strips every metadata segment itself
// so a photo can't reveal where it was taken or on what device.

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Removes EXIF/XMP (APP1), other application segments (APP2–APP15, which
 * include ICC, IPTC and maker data) and comments. Keeps APP0 (JFIF) and
 * everything needed to decode the image. Throws on anything that isn't a
 * well-formed JPEG.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (!isJpeg(bytes)) throw new Error('Not a JPEG');

  const kept: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Malformed JPEG');
    const marker = bytes[i + 1];

    // Fill bytes between segments.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Start of scan: the compressed image data follows to the end.
    if (marker === 0xda) {
      kept.push(bytes.subarray(i));
      break;
    }
    // Markers without a length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xd9) {
      kept.push(bytes.subarray(i, i + 2));
      break;
    }

    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) throw new Error('Malformed JPEG');
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) kept.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }

  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
