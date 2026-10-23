import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <Screen noHeader>
      <View style={styles.hero}>
        <ThemedText type="title">As One</ThemedText>
        <ThemedText themeColor="textSecondary">Nobody supports alone.</ThemedText>
      </View>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={signIn}
      />
      <ErrorText message={error} />
      <Button label="Sign in" onPress={signIn} busy={busy} disabled={!email || !password} />
      <Link href="/sign-up" style={styles.link}>
        <ThemedText type="linkPrimary">New here? Create an account</ThemedText>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Spacing.one, paddingVertical: Spacing.five },
  link: { alignSelf: 'center' },
});
