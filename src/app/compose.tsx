import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';
import {
  AUDIENCES,
  createPost,
  MAX_POST_LENGTH,
  POST_KINDS,
  type Audience,
  type PostKind,
} from '@/lib/posts';

export default function ComposeScreen() {
  const params = useLocalSearchParams<{ audience?: Audience }>();
  const [kind, setKind] = useState<PostKind>('struggle');
  const [audience, setAudience] = useState<Audience>(
    AUDIENCES.some((a) => a.audience === params.audience) ? params.audience! : 'corner',
  );
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prompt = POST_KINDS.find((k) => k.kind === kind)!.prompt;
  const audienceInfo = AUDIENCES.find((a) => a.audience === audience)!;

  async function share() {
    setBusy(true);
    setError(null);
    try {
      await createPost(kind, body.trim(), audience);
      if (audience === 'anonymous') {
        notify('Posted anonymously', 'It will appear in the Everyone feed in a few minutes.');
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ThemedText type="smallBold">What kind of post?</ThemedText>
      <ChipRow
        options={POST_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
        selected={kind}
        onSelect={setKind}
      />

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

      <ThemedText type="smallBold">Who can see this?</ThemedText>
      <ChipRow
        options={AUDIENCES.map((a) => ({ value: a.audience, label: a.label }))}
        selected={audience}
        onSelect={setAudience}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {audienceInfo.description}
      </ThemedText>

      <ErrorText message={error} />
      <Button label="Share" onPress={share} busy={busy} disabled={!body.trim()} />
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
});
