import { useState } from 'react';

import { Button, EmptyState, ErrorText, PersonRow, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { notify } from '@/lib/confirm';
import { getBlocked, unblockUser } from '@/lib/corner';

export default function BlockedScreen() {
  const { data, error, reload } = useLoad(getBlocked);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function unblock(id: string) {
    setBusyId(id);
    try {
      await unblockUser(id);
      await reload();
    } catch (e) {
      notify('Something went wrong', e instanceof Error ? e.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen>
      <ErrorText message={error} />
      {data && !data.length ? (
        <EmptyState title="No one blocked" body="People you block will be listed here." />
      ) : null}
      {data?.map((p) => (
        <PersonRow
          key={p.id}
          displayName={p.display_name}
          username={p.username}
          actions={
            <Button
              label="Unblock"
              variant="secondary"
              busy={busyId === p.id}
              onPress={() => unblock(p.id)}
            />
          }
        />
      ))}
    </Screen>
  );
}
