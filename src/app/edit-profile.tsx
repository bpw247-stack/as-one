import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, ErrorText, Field, Screen } from '@/components/ui';
import { useUserId } from '@/lib/auth';
import { getProfile, updateProfile } from '@/lib/corner';

export default function EditProfileScreen() {
  const myId = useUserId();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProfile(myId)
      .then((p) => {
        if (p) {
          setDisplayName(p.display_name);
          setBio(p.bio);
        }
      })
      .catch((e) => setError(e.message));
  }, [myId]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateProfile(myId, { display_name: displayName.trim(), bio: bio.trim() });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label="Name" value={displayName} onChangeText={setDisplayName} maxLength={40} />
      <Field
        label="Bio"
        value={bio}
        onChangeText={setBio}
        maxLength={160}
        multiline
        hint={`${bio.length}/160`}
      />
      <ErrorText message={error} />
      <Button label="Save" onPress={save} busy={busy} disabled={!displayName.trim()} />
    </Screen>
  );
}
