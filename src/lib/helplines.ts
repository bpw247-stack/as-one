// Crisis lines by country. Shown before a crisis post goes up, in the 48-hour
// banner, and behind the always-available "Get support" button.

import { getLocales } from 'expo-localization';
import { Linking, Platform } from 'react-native';

export type HelplineAction = { label: string; url: string };

export type Helplines = {
  country: string;
  lines: { name: string; detail: string; actions: HelplineAction[] }[];
  emergency: string;
};

const call = (number: string): HelplineAction => ({ label: `Call ${number}`, url: `tel:${number}` });
const text = (number: string, body?: string): HelplineAction => ({
  label: `Text ${number}`,
  // iOS and Android disagree on how to prefill an SMS body.
  url: body ? `sms:${number}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}` : `sms:${number}`,
});

const BY_REGION: Record<string, Helplines> = {
  US: {
    country: 'United States',
    emergency: '911',
    lines: [
      { name: '988 Suicide & Crisis Lifeline', detail: 'Free, confidential, 24/7.', actions: [call('988'), text('988')] },
      { name: 'Crisis Text Line', detail: 'Text HOME to 741741.', actions: [text('741741', 'HOME')] },
    ],
  },
  CA: {
    country: 'Canada',
    emergency: '911',
    lines: [{ name: '9-8-8 Suicide Crisis Helpline', detail: 'Free, 24/7.', actions: [call('988'), text('988')] }],
  },
  GB: {
    country: 'United Kingdom',
    emergency: '999',
    lines: [
      { name: 'Samaritans', detail: 'Free, 24/7.', actions: [call('116123')] },
      { name: 'Shout', detail: 'Text SHOUT to 85258.', actions: [text('85258', 'SHOUT')] },
    ],
  },
  IE: {
    country: 'Ireland',
    emergency: '112',
    lines: [{ name: 'Samaritans', detail: 'Free, 24/7.', actions: [call('116123')] }],
  },
  AU: {
    country: 'Australia',
    emergency: '000',
    lines: [{ name: 'Lifeline', detail: '24/7 crisis support.', actions: [call('131114'), text('0477131114')] }],
  },
  NZ: {
    country: 'New Zealand',
    emergency: '111',
    lines: [{ name: 'Need to talk?', detail: 'Free call or text 1737, 24/7.', actions: [call('1737'), text('1737')] }],
  },
};

const ELSEWHERE: Helplines = {
  country: 'your country',
  emergency: '112',
  lines: [
    {
      name: 'Find a Helpline',
      detail: 'Free, confidential crisis lines in your country.',
      actions: [{ label: 'Find a helpline', url: 'https://findahelpline.com' }],
    },
  ],
};

export function helplinesFor(region: string | null | undefined): Helplines {
  return (region && BY_REGION[region.toUpperCase()]) || ELSEWHERE;
}

export function localHelplines(): Helplines {
  let region: string | null = null;
  try {
    region = getLocales()[0]?.regionCode ?? null;
  } catch {
    // Fall through to the international list.
  }
  return helplinesFor(region);
}

export function open(action: HelplineAction) {
  Linking.openURL(action.url).catch(() => {});
}
