import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SongCard } from '@/components/song-card';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { searchSongs, type Song } from '@/lib/songs';

/** Search Apple's catalog and pick one song. */
export function SongPicker({ song, onChange }: { song: Song | null; onChange: (song: Song | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (song) return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const found = await searchSongs(query);
        if (current) {
          setResults(found);
          setError(null);
        }
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : String(e));
      }
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, song]);

  if (song) {
    return (
      <View style={styles.list}>
        <SongCard title={song.title} artist={song.artist} artworkUrl={song.artwork_url} url={song.url} />
        <Button label="Choose a different song" variant="secondary" onPress={() => onChange(null)} />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      <Field
        label="Find a song"
        value={query}
        onChangeText={setQuery}
        placeholder="Song or artist"
        autoCorrect={false}
      />
      <ErrorText message={error} />
      {results.map((s) => (
        <Pressable key={s.id} accessibilityRole="button" onPress={() => onChange(s)} style={styles.result}>
          {s.artwork_url ? <Image source={{ uri: s.artwork_url }} style={styles.thumb} /> : null}
          <View style={styles.flex}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {s.title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {s.artist}
            </ThemedText>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  result: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.one },
  thumb: { width: 44, height: 44, borderRadius: Spacing.one },
  flex: { flex: 1 },
});
