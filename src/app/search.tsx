import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ErrorText, Field, PersonRow, Screen } from '@/components/ui';
import { useUserId } from '@/lib/auth';
import { searchProfiles, type Profile } from '@/lib/corner';

export default function SearchScreen() {
  const myId = useUserId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const found = await searchProfiles(query, myId);
        if (current) {
          setResults(found);
          setError(null);
        }
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : String(e));
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, myId]);

  return (
    <Screen>
      <Field
        label="Username"
        value={query}
        onChangeText={setQuery}
        placeholder="@username"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />
      <ErrorText message={error} />
      {query.trim() && !results.length && !error ? (
        <ThemedText themeColor="textSecondary">No one with that username yet.</ThemedText>
      ) : null}
      {results.map((p) => (
        <PersonRow
          key={p.id}
          displayName={p.display_name}
          username={p.username}
          onPress={() => router.push(`/user/${p.username}`)}
        />
      ))}
    </Screen>
  );
}
