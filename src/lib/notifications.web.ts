// Push notifications are phone-only; on the web these do nothing.

export async function registerForPush(): Promise<void> {}

export async function unregisterForPush(): Promise<void> {}

export function usePushNotifications(_signedIn: boolean) {}
