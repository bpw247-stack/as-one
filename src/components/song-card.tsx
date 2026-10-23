import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { findOnSpotify, listenOnAppleMusic } from '@/lib/songs';

/** A song: album art, title and artist, with links to listen elsewhere. */
export function SongCard({
  title,
  artist,
  artworkUrl,
  url,
}: {
  title: string;
  artist: string;
  artworkUrl: string | null;
  url: string | null;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={styles.art} contentFit="cover" />
      ) : (
        <View style={[styles.art, { backgroundColor: theme.backgroundSelected }]} />
      )}
      <View style={styles.info}>
        <ThemedText type="smallBold" numberOfLines={2}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {artist}
        </ThemedText>
        <View style={styles.links}>
          {url ? (
            <Pressable accessibilityRole="link" onPress={() => listenOnAppleMusic(url)}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                Apple Music
              </ThemedText>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="link" onPress={() => findOnSpotify(title, artist)}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              Spotify
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  art: { width: 64, height: 64, borderRadius: Spacing.two },
  info: { flex: 1, gap: Spacing.half },
  links: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.one },
});
