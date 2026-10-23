import '@/lib/demo/web-shell';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { DialogHost } from '@/components/dialog-host';
import { ThemedText } from '@/components/themed-text';
import { Card, Screen } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { usePushNotifications } from '@/lib/notifications';
import { Colors } from '@/constants/theme';
import { isConfigured, isDemo } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <View style={styles.fill}>
          {isDemo ? <DemoBanner /> : null}
          <View style={styles.fill}>
            <RootNavigator />
          </View>
        </View>
        <DialogHost />
      </AuthProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();
  usePushNotifications(session !== null);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (!isConfigured) return <SetupNeeded />;
  if (loading) return null;

  const signedIn = session !== null;
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ title: 'Find people' }} />
        <Stack.Screen name="user/[username]" options={{ title: '' }} />
        <Stack.Screen name="edit-profile" options={{ title: 'Edit profile' }} />
        <Stack.Screen name="blocked" options={{ title: 'Blocked' }} />
        <Stack.Screen name="compose" options={{ title: 'Share', presentation: 'modal' }} />
        <Stack.Screen name="my-posts" options={{ title: 'Your posts' }} />
        <Stack.Screen name="post/[id]" options={{ title: 'Post' }} />
        <Stack.Screen name="support" options={{ title: 'Get support', presentation: 'modal' }} />
        <Stack.Screen name="report" options={{ title: 'Report', presentation: 'modal' }} />
        <Stack.Screen name="appeal" options={{ title: 'Appeal' }} />
        <Stack.Screen name="moderate" options={{ title: 'Review' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ title: 'Join As One' }} />
      </Stack.Protected>
      <Stack.Screen name="about" options={{ title: 'Guidelines', presentation: 'modal' }} />
    </Stack>
  );
}

function SetupNeeded() {
  return (
    <Screen title="Almost there" noHeader>
      <Card>
        <ThemedText>
          As One needs its Supabase keys. Copy .env.example to .env, fill in your project URL and
          anon key, then restart the app.
        </ThemedText>
      </Card>
    </Screen>
  );
}

function DemoBanner() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  return (
    <View style={[styles.banner, { backgroundColor: colors.accent }]}>
      <ThemedText type="small" style={{ color: colors.onAccent }}>
        Demo with sample people. Nothing is saved, and screening is simulated.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: { paddingVertical: 6, paddingHorizontal: 16, alignItems: 'center' },
});
