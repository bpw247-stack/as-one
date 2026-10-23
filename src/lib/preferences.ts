// Small per-device preferences. Kept on the phone: losing them only resets a
// default, never anything that matters for privacy on the server.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const SHOW_NAME_KEY = 'asone.reactions.showName';

let showName = true;
const listeners = new Set<(value: boolean) => void>();
const ready = AsyncStorage.getItem(SHOW_NAME_KEY)
  .then((stored) => {
    if (stored !== null) showName = stored === 'true';
  })
  .catch(() => {});

/** Whether posters see my name when I react. On by default; each person decides. */
export function useShowNameOnReact(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(showName);

  useEffect(() => {
    let active = true;
    ready.then(() => active && setValue(showName));
    listeners.add(setValue);
    return () => {
      active = false;
      listeners.delete(setValue);
    };
  }, []);

  function update(next: boolean) {
    showName = next;
    listeners.forEach((l) => l(next));
    AsyncStorage.setItem(SHOW_NAME_KEY, String(next)).catch(() => {});
  }

  return [value, update];
}
