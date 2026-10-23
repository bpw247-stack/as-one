// Photos for Corner posts. The app re-encodes each photo as a JPEG (which
// also drops its metadata) and uploads it to a private pending folder; the
// screen function strips it again, screens it, and publishes it.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { isDemo, supabase } from '@/lib/supabase';

export const MAX_PHOTOS = 4;
const BUCKET = 'post-photos';

/** Lets the person pick up to `limit` photos; returns local JPEG URIs. */
export async function pickPhotos(limit: number): Promise<string[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    exif: false,
    quality: 1,
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.slice(0, limit).map((asset) => toJpeg(asset.uri)));
}

async function toJpeg(uri: string): Promise<string> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return saved.uri;
}

/** Uploads a local JPEG to my pending folder and returns its storage path. */
export async function uploadPending(userId: string, uri: string): Promise<string> {
  const path = `pending/${userId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}.jpg`;
  // The demo keeps photos in the browser, so it stores the local URI as-is.
  const bytes = isDemo ? uri : await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg' });
  if (error) throw new Error(error.message);
  return path;
}

/** Short-lived URLs for photos I'm allowed to see (storage enforces who). */
export async function photoUrls(paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((d) => (d.signedUrl ? [d.signedUrl] : []));
}
