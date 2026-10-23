import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, Field, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { MIN_AGE, ageOn, parseBirthDate, usernameError } from '@/lib/validation';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signUp() {
    setError(null);
    const nameProblem = usernameError(username.trim());
    if (nameProblem) return setError(nameProblem);
    if (password.length < 8) return setError('Passwords need at least 8 characters.');
    const dob = parseBirthDate(birthDate);
    if (!dob) return setError('Enter your date of birth as MM/DD/YYYY.');
    if (ageOn(dob) < MIN_AGE) return setError('As One is for people 18 and older.');

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          username: username.trim(),
          display_name: displayName.trim() || username.trim(),
          birth_date: dob,
        },
      },
    });
    setBusy(false);

    if (error) {
      // The database rejects duplicate usernames inside the signup itself.
      setError(
        /database error/i.test(error.message)
          ? 'That username may already be taken. Try another one.'
          : error.message,
      );
    } else if (!data.session) {
      setCheckEmail(true);
    }
  }

  if (checkEmail) {
    return (
      <Screen title="Check your email">
        <Card>
          <ThemedText>
            We sent a confirmation link to {email.trim()}. Open it, then come back and sign in.
          </ThemedText>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText themeColor="textSecondary">
        As One is a space for support. Strangers can only send kind reactions, and only people you
        both add to your Corner can write to you.
      </ThemedText>
      <Field
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        hint="How people find you. Letters, numbers and underscores."
      />
      <Field label="Name" value={displayName} onChangeText={setDisplayName} hint="Optional" />
      <Field
        label="Date of birth"
        value={birthDate}
        onChangeText={setBirthDate}
        placeholder="MM/DD/YYYY"
        keyboardType="numbers-and-punctuation"
        hint="You must be 18 or older. Never shown to anyone."
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        hint="At least 8 characters."
      />
      <ErrorText message={error} />
      <Button
        label="Create account"
        onPress={signUp}
        busy={busy}
        disabled={!email || !password || !username || !birthDate}
      />
    </Screen>
  );
}
