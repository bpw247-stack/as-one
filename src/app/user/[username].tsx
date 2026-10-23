import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, ErrorText, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { useUserId } from '@/lib/auth';
import { confirm, notify } from '@/lib/confirm';
import {
  blockUser,
  cancelRequest,
  getProfileByUsername,
  getRelationship,
  removeFromCorner,
  respondToRequest,
  sendRequest,
  type Relationship,
} from '@/lib/corner';

const STATUS_TEXT: Record<Relationship, string | null> = {
  self: 'This is you.',
  corner: "You're in each other's Corner.",
  request_sent: "Corner request sent. They'll be in your Corner once they accept.",
  request_received: 'They want to be in your Corner.',
  none: null,
};

export default function UserScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const myId = useUserId();
  const [busy, setBusy] = useState(false);

  const { data, error, loaded, reload } = useLoad(async () => {
    const profile = await getProfileByUsername(username);
    if (!profile) return null;
    return { profile, relationship: await getRelationship(myId, profile.id) };
  });

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (e) {
      notify('Something went wrong', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <Screen />;
  }
  if (!data) {
    return (
      <Screen>
        <ErrorText message={error} />
        <EmptyState title="Not found" body="No one with that username." />
      </Screen>
    );
  }

  const { profile, relationship } = data;
  const status = STATUS_TEXT[relationship];

  async function onRemove() {
    const ok = await confirm(
      `Remove ${profile.display_name}?`,
      "You'll both be removed from each other's Corner. They won't be notified.",
      'Remove',
    );
    if (ok) act(() => removeFromCorner(profile.id));
  }

  async function onBlock() {
    const ok = await confirm(
      `Block ${profile.display_name}?`,
      "They won't be able to find you, see anything you post, or contact you in any way. They won't be told.",
      'Block',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await blockUser(profile.id);
      router.back();
    } catch (e) {
      setBusy(false);
      notify('Something went wrong', e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: `@${profile.username}` }} />
      <ErrorText message={error} />
      <Card>
        <ThemedText type="subtitle">{profile.display_name}</ThemedText>
        <ThemedText themeColor="textSecondary">@{profile.username}</ThemedText>
        {profile.bio ? <ThemedText>{profile.bio}</ThemedText> : null}
        {status ? (
          <ThemedText type="small" themeColor="textSecondary">
            {status}
          </ThemedText>
        ) : null}

        {relationship === 'none' ? (
          <Button
            label="Add to my Corner"
            busy={busy}
            onPress={() => act(() => sendRequest(profile.username))}
          />
        ) : null}
        {relationship === 'request_received' ? (
          <>
            <Button
              label="Accept"
              busy={busy}
              onPress={() => act(() => respondToRequest(profile.id, true))}
            />
            <Button
              label="Decline"
              variant="secondary"
              disabled={busy}
              onPress={() => act(() => respondToRequest(profile.id, false))}
            />
          </>
        ) : null}
        {relationship === 'request_sent' ? (
          <Button
            label="Cancel request"
            variant="secondary"
            busy={busy}
            onPress={() => act(() => cancelRequest(profile.id))}
          />
        ) : null}
        {relationship === 'corner' ? (
          <Button label="Remove from my Corner" variant="secondary" disabled={busy} onPress={onRemove} />
        ) : null}
      </Card>

      {relationship !== 'self' ? (
        <>
          <EmptyState
            title="No public posts yet"
            body="Posts they share with everyone will show up here."
          />
          <Button label="Block" variant="danger" disabled={busy} onPress={onBlock} />
        </>
      ) : null}
    </Screen>
  );
}
