import { HelplineList } from '@/components/crisis-support';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui';

// Always reachable from the Me tab and the support banner, independent of
// whether anything was detected.
export default function SupportScreen() {
  return (
    <Screen>
      <ThemedText type="subtitle">You&apos;re not alone</ThemedText>
      <ThemedText>
        If things feel like too much, reach out. These lines are free and confidential, and someone is
        there 24/7.
      </ThemedText>
      <HelplineList />
    </Screen>
  );
}
