import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, ErrorText, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useLoad } from '@/hooks/use-load';
import { confirm, notify } from '@/lib/confirm';
import {
  appealQueue,
  decideAppeal,
  decidePause,
  decideReport,
  pauseQueue,
  REPORT_REASONS,
  reviewQueue,
} from '@/lib/safety';
import { timeAgo } from '@/lib/time';

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map((r) => [r.reason, r.label]));

// The moderators' review queue: reports (most dangerous first), commenting
// paused by repeated blocked attempts, and appeals from other moderators'
// decisions.
export default function ModerateScreen() {
  const { data, error, reload } = useLoad(() => Promise.all([reviewQueue(), pauseQueue(), appealQueue()]));
  const [busy, setBusy] = useState<string | null>(null);
  const [reports, pauses, appeals] = data ?? [[], [], []];

  async function act(key: string, action: () => Promise<void>, warning?: string) {
    if (warning && !(await confirm('Are you sure?', warning, 'Confirm'))) return;
    setBusy(key);
    try {
      await action();
      await reload();
    } catch (e) {
      notify('Something went wrong', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <ErrorText message={error} />
      {data && !reports.length && !pauses.length && !appeals.length ? (
        <EmptyState title="Nothing to review" body="Reports, paused accounts and appeals will show up here." />
      ) : null}

      {reports.map((r) => (
        <Card key={r.report_id}>
          <ThemedText type="smallBold">
            {REASON_LABELS[r.reason] ?? r.reason} · {r.target_type}
            {r.report_count > 1 ? ` · ${r.report_count} reports` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            @{r.author_username ?? 'deleted'} · {r.author_prior_actions} prior actions · reported{' '}
            {timeAgo(r.created_at)}
          </ThemedText>
          <ThemedText>“{r.content ?? '(already deleted)'}”</ThemedText>
          {r.details ? (
            <ThemedText type="small" themeColor="textSecondary">
              Reporter: {r.details}
            </ThemedText>
          ) : null}
          <View style={styles.actions}>
            <Button
              label="Dismiss"
              variant="secondary"
              busy={busy === r.report_id}
              onPress={() => act(r.report_id, () => decideReport(r.report_id, 'dismiss'))}
            />
            <Button
              label="Dismiss · bad faith"
              variant="secondary"
              disabled={busy !== null}
              onPress={() => act(r.report_id, () => decideReport(r.report_id, 'dismiss', true))}
            />
            <Button
              label="Warn"
              variant="secondary"
              disabled={busy !== null}
              onPress={() => act(r.report_id, () => decideReport(r.report_id, 'warn'))}
            />
            <Button
              label="7 days"
              variant="secondary"
              disabled={busy !== null}
              onPress={() => act(r.report_id, () => decideReport(r.report_id, 'suspend_7'))}
            />
            <Button
              label="30 days"
              variant="secondary"
              disabled={busy !== null}
              onPress={() => act(r.report_id, () => decideReport(r.report_id, 'suspend_30'))}
            />
            <Button
              label="Ban"
              variant="danger"
              disabled={busy !== null}
              onPress={() =>
                act(r.report_id, () => decideReport(r.report_id, 'ban'), 'This permanently bans the account.')
              }
            />
          </View>
        </Card>
      ))}

      {pauses.map((p) => (
        <Card key={p.username}>
          <ThemedText type="smallBold">Commenting paused · @{p.username}</ThemedText>
          {p.attempts?.map((a, i) => (
            <ThemedText key={i} type="small" themeColor="textSecondary">
              {a.category}: “{a.excerpt}”
            </ThemedText>
          ))}
          <View style={styles.actions}>
            <Button
              label="Restore"
              variant="secondary"
              busy={busy === p.username}
              onPress={() => act(p.username, () => decidePause(p.username, 'restore'))}
            />
            <Button
              label="Keep paused"
              variant="secondary"
              disabled={busy !== null}
              onPress={() => act(p.username, () => decidePause(p.username, 'restrict'))}
            />
            <Button
              label="Ban"
              variant="danger"
              disabled={busy !== null}
              onPress={() =>
                act(p.username, () => decidePause(p.username, 'ban'), 'This permanently bans the account.')
              }
            />
          </View>
        </Card>
      ))}

      {appeals.map((a) => (
        <Card key={a.appeal_id}>
          <ThemedText type="smallBold">
            Appeal · @{a.author_username} · {a.decision}
          </ThemedText>
          <ThemedText>“{a.message}”</ThemedText>
          <View style={styles.actions}>
            <Button
              label="Overturn"
              variant="secondary"
              busy={busy === a.appeal_id}
              onPress={() => act(a.appeal_id, () => decideAppeal(a.appeal_id, true))}
            />
            <Button
              label="Uphold"
              variant="secondary"
              disabled={busy !== null}
              onPress={() => act(a.appeal_id, () => decideAppeal(a.appeal_id, false))}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
