// Turning queued notifications into Expo push messages, and reading Expo's
// replies. Kept free of Deno APIs so it can be tested in Node.

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH = 100;

export type QueuedNotification = {
  id: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
  tokens: string[];
};

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
};

export type PushTicket = { status: 'ok' } | { status: 'error'; details?: { error?: string } };

export function toMessages(notifications: QueuedNotification[]): PushMessage[] {
  return notifications.flatMap((n) =>
    n.tokens.map((to) => ({ to, title: n.title, body: n.body, data: n.data, sound: 'default' as const })),
  );
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Tokens Expo reports as uninstalled or invalid, so they can be forgotten. */
export function deadTokens(messages: PushMessage[], tickets: PushTicket[]): string[] {
  return tickets.flatMap((ticket, i) =>
    ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' && messages[i]
      ? [messages[i].to]
      : [],
  );
}
