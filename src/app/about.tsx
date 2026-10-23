import { Linking, Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Screen } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

// Full documents live in the repository's docs/ folder; these links are what
// the App Store listing points to as well.
const DOCS = 'https://github.com/bpw247-stack/as-one/blob/main/docs';

const NOT_ALLOWED = [
  'Hate based on who someone is',
  'Threats of violence or harm',
  'Encouraging anyone to hurt themselves',
  'Harassment and insults meant to wound',
  'Sexual content aimed at someone, or nudity',
  'Sharing private information, or trying to unmask anonymous posters',
  'Graphic or gory images, or hate symbols',
];

export default function AboutScreen() {
  const theme = useTheme();
  const link = (label: string, file: string) => (
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${DOCS}/${file}`)}>
      <ThemedText style={{ color: theme.accent }}>{label}</ThemedText>
    </Pressable>
  );

  return (
    <Screen>
      <ThemedText type="subtitle">Community Guidelines</ThemedText>
      <ThemedText>
        As One is a place to share struggles, goals and wins, and to support each other. There is
        zero tolerance for hate or abuse.
      </ThemedText>
      <Card>
        <ThemedText type="smallBold">Not allowed</ThemedText>
        {NOT_ALLOWED.map((item) => (
          <ThemedText key={item} type="small">
            • {item}
          </ThemedText>
        ))}
      </Card>
      <Card>
        <ThemedText type="smallBold">Welcome</ThemedText>
        <ThemedText type="small">
          Honesty, tough love, swearing, venting, and frank talk about addiction, sobriety, mental
          health and grief.
        </ThemedText>
      </Card>
      <ThemedText type="small" themeColor="textSecondary">
        Everything is screened before it&apos;s shared. Breaking these rules leads to removal and,
        depending on how serious it is, a warning, a suspension or a permanent ban — decided by a
        person, with one appeal. You must be 18 or older.
      </ThemedText>
      {link('Full Community Guidelines', 'COMMUNITY_GUIDELINES.md')}
      {link('Terms of Use', 'TERMS.md')}
      {link('Privacy Policy', 'PRIVACY.md')}
    </Screen>
  );
}
