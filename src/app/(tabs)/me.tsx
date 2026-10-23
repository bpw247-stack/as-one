import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PersonRow, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { useUserId } from '@/lib/auth';
import { confirm, notify } from '@/lib/confirm';
import { deleteAccount, getCorner, getProfile } from '@/lib/corner';
import { unregisterForPush } from '@/lib/notifications';
import { useShowNameOnReact } from '@/lib/preferences';
import { DECISION_LABELS, myDecisions, myStatus } from '@/lib/safety';
import { MAX_BUDDIES, myBuddies } from '@/lib/buddies';
import { supabase } from '@/lib/supabase';

export default function MeScreen() {
  const myId = useUserId();
  const { data, error } = useLoad(() =>
    Promise.all([getProfile(myId), getCorner(myId), myStatus(), myDecisions(), myBuddies()]),
  );
  const [deleting, setDeleting] = useState(false);
  const [showName, setShowName] = useShowNameOnReact();
  const [profile, corner, status, decisions, buddies] = data ?? [null, [], null, [], []];
  const suspended = status?.suspended_until && new Date(status.suspended_until) > new Date();

  async function onDelete() {
    const ok = await confirm(
      'Delete your account?',
      'This permanently deletes your account and everything you have shared, including anonymous posts. It cannot be undone.',
      'Delete everything',
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (e) {
      setDeleting(false);
      notify('Could not delete your account', e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <Screen withTabBar>
      <ErrorText message={error} />
      <Button label="Get support" variant="secondary" onPress={() => router.push('/support')} />

      {status?.banned || suspended || status?.comment_paused ? (
        <Card>
          <ThemedText type="smallBold">Your account</ThemedText>
          <ThemedText type="small">
            {status?.banned
              ? 'Your account has been permanently banned for breaking As One’s rules.'
              : suspended
                ? `Your account is suspended until ${new Date(status!.suspended_until!).toLocaleDateString()}. You can still read, but not post, comment or react.`
                : 'Your ability to comment is paused while we review recent activity. You can still post and react.'}
          </ThemedText>
        </Card>
      ) : null}

      {decisions.map((d) => (
        <Card key={d.report_id}>
          <ThemedText type="smallBold">A decision about your {d.target_type}</ThemedText>
          <ThemedText type="small">{DECISION_LABELS[d.decision] ?? d.decision}</ThemedText>
          {d.appeal_status ? (
            <ThemedText type="small" themeColor="textSecondary">
              Appeal {d.appeal_status === 'open' ? 'under review' : d.appeal_status}
            </ThemedText>
          ) : (
            <Button
              label="Appeal"
              variant="secondary"
              onPress={() => router.push({ pathname: '/appeal', params: { reportId: d.report_id } })}
            />
          )}
        </Card>
      ))}

      {profile ? (
        <Card>
          <ThemedText type="subtitle">{profile.display_name}</ThemedText>
          <ThemedText themeColor="textSecondary">@{profile.username}</ThemedText>
          {profile.bio ? <ThemedText>{profile.bio}</ThemedText> : null}
          <Button label="Edit profile" variant="secondary" onPress={() => router.push('/edit-profile')} />
        </Card>
      ) : null}

      <Card>
        <ThemedText type="smallBold">
          Your buddies · {buddies.length}/{MAX_BUDDIES}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Your closest people. They can be notified when you post, and they&apos;re told if you might
          need extra support. Add a buddy from their profile.
        </ThemedText>
        {buddies.map((b) => (
          <PersonRow
            key={b.id}
            displayName={b.display_name}
            username={b.username}
            onPress={() => router.push(`/user/${b.username}`)}
          />
        ))}
      </Card>

      <Card>
        <ThemedText type="smallBold">
          Your Corner · {corner.length} {corner.length === 1 ? 'person' : 'people'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Only you can see this. Positivity isn&apos;t a competition.
        </ThemedText>
        {corner.map((p) => (
          <PersonRow
            key={p.id}
            displayName={p.display_name}
            username={p.username}
            onPress={() => router.push(`/user/${p.username}`)}
          />
        ))}
        <Button label="Find people" onPress={() => router.push('/search')} />
      </Card>

      <Card>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">Show my name when I react</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              When off, people see your reactions as coming from “Someone.”
            </ThemedText>
          </View>
          <Switch value={showName} onValueChange={setShowName} />
        </View>
      </Card>

      {status?.is_moderator ? (
        <Button label="Review reports" variant="secondary" onPress={() => router.push('/moderate')} />
      ) : null}
      <Button label="Your posts" variant="secondary" onPress={() => router.push('/my-posts')} />
      <Button label="Blocked people" variant="secondary" onPress={() => router.push('/blocked')} />
      <Button label="Sign out" variant="secondary" onPress={async () => {
          await unregisterForPush().catch(() => {});
          await supabase.auth.signOut();
        }} />
      <Button label="Delete account" variant="danger" busy={deleting} onPress={onDelete} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flex: { flex: 1 },
});
