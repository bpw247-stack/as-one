// Makes the demo build tolerate being embedded where the browser won't let a
// page change its own address (some sandboxed frames refuse it). Navigation
// keeps working inside the app; only the address bar stops following along.

import { Platform } from 'react-native';

import { isDemo } from '@/lib/supabase';

if (isDemo && Platform.OS === 'web' && typeof window !== 'undefined') {
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History['pushState']>) => {
      try {
        original(...args);
      } catch {
        // Ignored: the in-app navigation state is the source of truth.
      }
    };
  }
}
