import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { localHelplines, open } from '@/lib/helplines';

/** The helplines for where the person is, with one-tap call/text buttons. */
export function HelplineList() {
  const helplines = localHelplines();
  return (
    <View style={styles.list}>
      {helplines.lines.map((line) => (
        <Card key={line.name}>
          <ThemedText type="smallBold">{line.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {line.detail}
          </ThemedText>
          {line.actions.map((action) => (
            <Button key={action.url} label={action.label} onPress={() => open(action)} />
          ))}
        </Card>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        If you are in immediate danger, call {helplines.emergency} now.
      </ThemedText>
    </View>
  );
}

/**
 * Shown before a post that might be a crisis goes up. The post still goes up
 * if they choose — but only after a deliberate tap past real help.
 */
export function CrisisInterstitial({
  onContinue,
  onBack,
  busy,
}: {
  onContinue: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.list}>
      <ThemedText type="subtitle">You matter, and you don&apos;t have to carry this alone.</ThemedText>
      <ThemedText>
        It sounds like you&apos;re going through something really heavy. Talking to someone right now can help —
        it&apos;s free, private, and they&apos;re there any time.
      </ThemedText>
      <HelplineList />
      <View style={styles.choices}>
        <ThemedText type="small" themeColor="textSecondary">
          You can still share your post. People will be able to send support, and no one will be able to
          write comments on it.
        </ThemedText>
        <Button label="I've seen this — share my post" variant="secondary" onPress={onContinue} busy={busy} />
        <Button label="Go back to my draft" variant="secondary" onPress={onBack} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  choices: { gap: Spacing.two, marginTop: Spacing.three },
});
