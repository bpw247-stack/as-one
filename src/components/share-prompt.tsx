import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import type { Audience } from '@/lib/posts';

/** The "share something" box at the top of each feed. */
export function SharePrompt({ audience }: { audience: Audience }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/compose', params: { audience } })}>
      <Card>
        <ThemedText themeColor="textSecondary">Share a struggle, goal or win…</ThemedText>
      </Card>
    </Pressable>
  );
}
