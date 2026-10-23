import { router } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, ErrorText, PersonRow, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { useUserId } from '@/lib/auth';
import { notify } from '@/lib/confirm';
import { cancelRequest, getRequests, respondToRequest } from '@/lib/corner';

export default function ActivityScreen() {
  const myId = useUserId();
  const { data, error, reload } = useLoad(() => getRequests(myId));
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, action: () => Promise<void>) {
    setBusyId(id);
    try {
      await action();
      await reload();
    } catch (e) {
      notify('Something went wrong', e instanceof Error ? e.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];

  return (
    <Screen title="Activity" withTabBar>
      <ErrorText message={error} />

      {data && !incoming.length && !outgoing.length ? (
        <EmptyState
          title="All caught up"
          body="Corner requests will show up here. Reactions and comments will too, once posting arrives."
        />
      ) : null}

      {incoming.length ? (
        <Card>
          <ThemedText type="smallBold">Want to be in your Corner</ThemedText>
          {incoming.map((p) => (
            <PersonRow
              key={p.id}
              displayName={p.display_name}
              username={p.username}
              onPress={() => router.push(`/user/${p.username}`)}
              actions={
                <>
                  <Button
                    label="Accept"
                    busy={busyId === p.id}
                    onPress={() => act(p.id, () => respondToRequest(p.id, true))}
                  />
                  <Button
                    label="Decline"
                    variant="secondary"
                    disabled={busyId === p.id}
                    onPress={() => act(p.id, () => respondToRequest(p.id, false))}
                  />
                </>
              }
            />
          ))}
        </Card>
      ) : null}

      {outgoing.length ? (
        <Card>
          <ThemedText type="smallBold">Waiting on</ThemedText>
          {outgoing.map((p) => (
            <PersonRow
              key={p.id}
              displayName={p.display_name}
              username={p.username}
              onPress={() => router.push(`/user/${p.username}`)}
              actions={
                <Button
                  label="Cancel"
                  variant="secondary"
                  busy={busyId === p.id}
                  onPress={() => act(p.id, () => cancelRequest(p.id))}
                />
              }
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
