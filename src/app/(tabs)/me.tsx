import { router } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PersonRow, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { useUserId } from '@/lib/auth';
import { confirm, notify } from '@/lib/confirm';
import { deleteAccount, getCorner, getProfile } from '@/lib/corner';
import { supabase } from '@/lib/supabase';

export default function MeScreen() {
  const myId = useUserId();
  const { data, error } = useLoad(() => Promise.all([getProfile(myId), getCorner(myId)]));
  const [deleting, setDeleting] = useState(false);
  const [profile, corner] = data ?? [null, []];

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

      <Button label="Blocked people" variant="secondary" onPress={() => router.push('/blocked')} />
      <Button label="Sign out" variant="secondary" onPress={() => supabase.auth.signOut()} />
      <Button label="Delete account" variant="danger" busy={deleting} onPress={onDelete} />
    </Screen>
  );
}
