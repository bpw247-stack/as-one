import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { photoUrls } from '@/lib/photos';

/** A post's photos, loaded through short-lived signed URLs. */
export function PostPhotos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  const key = paths.join('|');

  useEffect(() => {
    let active = true;
    photoUrls(key ? key.split('|') : [])
      .then((u) => active && setUrls(u))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key]);

  if (!urls.length) return null;
  return (
    <View style={styles.grid}>
      {urls.map((url) => (
        <Image
          key={url}
          source={{ uri: url }}
          style={[styles.photo, urls.length === 1 && styles.single]}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  photo: { width: '49%', aspectRatio: 1, borderRadius: Spacing.two },
  single: { width: '100%', aspectRatio: 4 / 3 },
});
