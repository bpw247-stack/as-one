import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { CrisisInterstitial } from '@/components/crisis-support';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, Field, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';
import {
  AUDIENCES,
  MAX_POST_LENGTH,
  POST_KINDS,
  type Audience,
  type PostKind,
} from '@/lib/posts';
import { problemWith, publishPost } from '@/lib/publish';

export default function ComposeScreen() {
  const params = useLocalSearchParams<{
    audience?: Audience;
    followUpOf?: string;
    followUpExcerpt?: string;
  }>();
  const followUpOf = params.followUpOf;
  const [kind, setKind] = useState<PostKind>(followUpOf ? 'milestone' : 'struggle');
  const [commentsPrivate, setCommentsPrivate] = useState(false);
  const [audience, setAudience] = useState<Audience>(
    AUDIENCES.some((a) => a.audience === params.audience) ? params.audience! : 'corner',
  );
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when screening thinks this might be a crisis: the helpline comes first.
  const [crisisHold, setCrisisHold] = useState(false);

  const prompt = followUpOf
    ? kind === 'milestone'
      ? 'You did it! Tell everyone who supported you.'
      : 'How is it going?'
    : POST_KINDS.find((k) => k.kind === kind)!.prompt;
  const kindOptions = followUpOf
    ? [
        { value: 'milestone' as PostKind, label: 'I did it!' },
        { value: 'goal' as PostKind, label: 'Progress update' },
      ]
    : POST_KINDS.map((k) => ({ value: k.kind, label: k.label }));
  const audienceInfo = AUDIENCES.find((a) => a.audience === audience)!;

  async function share(crisisAcknowledged = false) {
    setBusy(true);
    setError(null);
    try {
      const result = await publishPost(kind, body.trim(), audience, {
        commentsPrivate,
        followUpOf,
        crisisAcknowledged,
      });
      if (result.status === 'crisis') {
        setCrisisHold(true);
        setBusy(false);
        return;
      }
      const problem = problemWith(result);
      if (problem) {
        setCrisisHold(false);
        setError(problem);
        setBusy(false);
        return;
      }
      if (crisisAcknowledged) {
        router.replace('/support');
        return;
      }
      if (audience === 'anonymous' && !followUpOf) {
        notify('Posted anonymously', 'It will appear in the Everyone feed in a few minutes.');
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (crisisHold) {
    return (
      <Screen>
        <CrisisInterstitial busy={busy} onContinue={() => share(true)} onBack={() => setCrisisHold(false)} />
      </Screen>
    );
  }

  return (
    <Screen>
      {followUpOf ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Follow-up to your goal
          </ThemedText>
          <ThemedText>“{params.followUpExcerpt}”</ThemedText>
        </Card>
      ) : null}

      <ThemedText type="smallBold">{followUpOf ? 'What’s the update?' : 'What kind of post?'}</ThemedText>
      <ChipRow options={kindOptions} selected={kind} onSelect={setKind} />

      <Field
        label={prompt}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={MAX_POST_LENGTH}
        style={styles.body}
        textAlignVertical="top"
        hint={`${body.length}/${MAX_POST_LENGTH}`}
      />

      {followUpOf ? (
        <ThemedText type="small" themeColor="textSecondary">
          Shared with the same people as your original goal. Everyone who supported it will be
          told.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="smallBold">Who can see this?</ThemedText>
          <ChipRow
            options={AUDIENCES.map((a) => ({ value: a.audience, label: a.label }))}
            selected={audience}
            onSelect={setAudience}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {audienceInfo.description}
          </ThemedText>
          {audience !== 'anonymous' ? (
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <ThemedText type="smallBold">Only I see comments</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Each person sees only their own comment and your reply.
                </ThemedText>
              </View>
              <Switch value={commentsPrivate} onValueChange={setCommentsPrivate} />
            </View>
          ) : null}
        </>
      )}

      <ErrorText message={error} />
      <Button label="Share" onPress={() => share()} busy={busy} disabled={!body.trim()} />
    </Screen>
  );
}

function ChipRow<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(o.value)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.accent : theme.backgroundElement,
                borderColor: active ? theme.accent : theme.border,
              },
            ]}>
            <ThemedText type="smallBold" style={{ color: active ? theme.onAccent : theme.text }}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
  },
  body: { minHeight: 140, paddingTop: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  flex: { flex: 1 },
});
