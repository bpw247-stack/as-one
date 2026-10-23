import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { useTheme } from '@/hooks/use-theme';
import { inCrisisSupport, myStatus } from '@/lib/safety';

/** Pinned at the top of the feeds for 48 hours after a crisis post. */
export function SupportBanner() {
  const theme = useTheme();
  const { data } = useLoad(myStatus);
  if (!inCrisisSupport(data)) return null;

  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/support')}>
      <Card>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          We&apos;re thinking of you
        </ThemedText>
        <ThemedText type="small">
          Support is here any time — free and confidential, 24/7. Tap to call or text someone now.
        </ThemedText>
      </Card>
    </Pressable>
  );
}
