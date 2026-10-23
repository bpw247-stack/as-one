/** "Just now", "5m", "3h", "2d", or a date for anything older than a week. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Anonymous posts arrive with their time rounded down to the hour, so minutes
 * would be misleading. Show hours at the finest.
 */
export function anonymousTimeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 3600) return 'Within the hour';
  return timeAgo(iso, now);
}

/** True if a post isn't visible to others yet (anonymous posts wait a few minutes). */
export function isPending(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() > now.getTime();
}
