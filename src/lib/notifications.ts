// Push notifications. As One only pushes for a buddy posting (when they chose
// to notify), a buddy who might need support, a goal you supported being
// accomplished, and the private check-in after a crisis post.

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

let currentToken: string | null = null;

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Asks for permission and registers this device. Skips quietly where push can't work. */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  // The Expo project id comes from `eas init` (app.json → extra.eas.projectId).
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'As One',
      importance: AndroidImportance.DEFAULT,
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  currentToken = token;
  await supabase.rpc('register_push_token', { token });
}

/** Stops pushes to this device; call before signing out. */
export async function unregisterForPush(): Promise<void> {
  if (!currentToken) return;
  await supabase.rpc('unregister_push_token', { token: currentToken });
  currentToken = null;
}

function openFrom(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as
    | { post_id?: string; screen?: string }
    | undefined;
  if (data?.post_id) router.push(`/post/${data.post_id}`);
  else if (data?.screen === 'support') router.push('/support');
}

/** Registers for push once signed in, and opens the right screen when a notification is tapped. */
export function usePushNotifications(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn || Platform.OS === 'web') return;
    registerForPush().catch((e) => console.warn('push registration failed', e));
    openFrom(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(openFrom);
    return () => subscription.remove();
  }, [signedIn]);
}
