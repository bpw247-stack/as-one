import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field, Screen } from '@/components/ui';
import { notify } from '@/lib/confirm';
import { appeal } from '@/lib/safety';

export default function AppealScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await appeal(reportId, message.trim());
      notify('Appeal sent', 'A different moderator will review it.');
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ThemedText>
        You can appeal each decision once. A different moderator from the one who made the decision will
        review it.
      </ThemedText>
      <Field label="Why should this be reconsidered?" value={message} onChangeText={setMessage} multiline maxLength={1000} />
      <ErrorText message={error} />
      <Button label="Send appeal" onPress={send} busy={busy} disabled={!message.trim()} />
    </Screen>
  );
}
