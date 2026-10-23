import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, Field, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { report, REPORT_REASONS, type ReportTarget } from '@/lib/safety';

export default function ReportScreen() {
  const { type, id } = useLocalSearchParams<{ type: ReportTarget; id: string }>();
  const theme = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await report(type, id, reason, details.trim());
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Card>
          <ThemedText type="smallBold">Thank you. We&apos;re reviewing this.</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Reports are confidential — the person won&apos;t know who reported them. You can also block them
            from their profile.
          </ThemedText>
        </Card>
        <Button label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText type="smallBold">What&apos;s wrong with this {type}?</ThemedText>
      {REPORT_REASONS.map((r) => {
        const active = r.reason === reason;
        return (
          <Pressable
            key={r.reason}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => setReason(r.reason)}
            style={[
              styles.option,
              { borderColor: active ? theme.accent : theme.border, backgroundColor: theme.backgroundElement },
            ]}>
            <ThemedText style={active ? { color: theme.accent } : undefined}>{r.label}</ThemedText>
          </Pressable>
        );
      })}
      <Field
        label="Anything we should know? (optional)"
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={1000}
      />
      <ErrorText message={error} />
      <Button label="Send report" onPress={send} busy={busy} disabled={!reason} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.three },
});
