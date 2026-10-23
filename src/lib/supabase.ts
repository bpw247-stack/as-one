import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { createDemoClient } from '@/lib/demo/client';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The demo build (EXPO_PUBLIC_DEMO=1) runs on sample data in memory, with no
 * server: for trying the app in a browser. Nothing is saved.
 */
export const isDemo = process.env.EXPO_PUBLIC_DEMO === '1';

/** False until the Supabase keys are filled in (see .env.example). */
export const isConfigured = isDemo || Boolean(url && anonKey);

export const supabase: SupabaseClient = isDemo
  ? (createDemoClient() as unknown as SupabaseClient)
  : createClient(url ?? 'http://localhost', anonKey ?? 'not-configured', {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });

// Only refresh the session while the app is open, so a backgrounded phone
// doesn't keep waking up to talk to the server.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
