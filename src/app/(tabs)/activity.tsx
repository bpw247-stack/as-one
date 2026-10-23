import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, ErrorText, PersonRow, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { useUserId } from '@/lib/auth';
import { notify } from '@/lib/confirm';
import {
  buddySuggestions,
  myBuddyRequests,
  respondToBuddyRequest,
  sendBuddyRequest,
} from '@/lib/buddies';
import { cancelRequest, getRequests, respondToRequest } from '@/lib/corner';
import { myActivity, REACTION_LABELS, type ActivityItem } from '@/lib/posts';
import { timeAgo } from '@/lib/time';

// Corner requests, plus reactions, comments, replies and goal follow-ups.
// Everything here is in-app only — none of it sends a push notification.
export default function ActivityScreen() {
  const myId = useUserId();
  const { data, error, reload } = useLoad(async () => {
    const [requests, activity, buddyRequests, suggestions] = await Promise.all([
      getRequests(myId),
      myActivity(),
      myBuddyRequests(),
      buddySuggestions(),
    ]);
    return { ...requests, activity, buddyRequests: buddyRequests.filter((b) => b.incoming), suggestions };
  });
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
  const activity = data?.activity ?? [];
  const buddyRequests = data?.buddyRequests ?? [];
  const suggestions = data?.suggestions ?? [];

  return (
    <Screen title="Activity" withTabBar>
      <ErrorText message={error} />

      {data &&
      !incoming.length &&
      !outgoing.length &&
      !activity.length &&
      !buddyRequests.length &&
      !suggestions.length ? (
        <EmptyState
          title="All caught up"
          body="Corner requests, reactions and comments on your posts will show up here."
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

      {buddyRequests.length ? (
        <Card>
          <ThemedText type="smallBold">Want to be your buddy</ThemedText>
          {buddyRequests.map((p) => (
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
                    onPress={() => act(p.id, () => respondToBuddyRequest(p.id, true))}
                  />
                  <Button
                    label="Decline"
                    variant="secondary"
                    disabled={busyId === p.id}
                    onPress={() => act(p.id, () => respondToBuddyRequest(p.id, false))}
                  />
                </>
              }
            />
          ))}
        </Card>
      ) : null}

      {suggestions.map((p) => (
        <Card key={`suggest-${p.id}`}>
          <ThemedText>
            You and {p.display_name} support each other a lot. Want to become buddies?
          </ThemedText>
          <Button
            label="Ask to be buddies"
            variant="secondary"
            busy={busyId === p.id}
            onPress={() =>
              act(p.id, async () => {
                await sendBuddyRequest(p.id);
              })
            }
          />
        </Card>
      ))}

      {activity.map((item, i) => (
        <Pressable
          key={`${item.kind}-${item.post_id}-${item.created_at}-${i}`}
          onPress={() => router.push(`/post/${item.post_id}`)}>
          <Card>
            <ThemedText>{describe(item)}</ThemedText>
            {item.body && item.kind !== 'follow_up' ? (
              <ThemedText themeColor="textSecondary">“{item.body}”</ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {timeAgo(item.created_at)}
            </ThemedText>
          </Card>
        </Pressable>
      ))}

      {outgoing.length ? (
        <Card>
          <ThemedText type="smallBold">Corner requests you sent</ThemedText>
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

function describe(item: ActivityItem): string {
  const who = item.actor_display_name ?? 'Someone';
  switch (item.kind) {
    case 'reaction':
      return `${who} sent “${REACTION_LABELS[item.reaction ?? ''] ?? item.reaction}” on “${item.post_excerpt}”`;
    case 'comment':
      return `${who} commented on “${item.post_excerpt}”`;
    case 'reply':
      return `${who} replied to your comment`;
    case 'follow_up':
      return `${who} posted a follow-up to a goal you supported: “${item.body}”`;
  }
}
