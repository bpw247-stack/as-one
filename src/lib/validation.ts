// Mirrors the database checks so people see a friendly message before the
// server ever rejects anything. The database stays the source of truth.

export const MIN_AGE = 18;

export function usernameError(username: string): string | null {
  if (username.length < 3) return 'Usernames need at least 3 characters.';
  if (username.length > 20) return 'Usernames can be at most 20 characters.';
  if (!/^[A-Za-z0-9_]+$/.test(username)) return 'Use only letters, numbers and underscores.';
  return null;
}

/** Parses MM/DD/YYYY into an ISO date (YYYY-MM-DD), or null if it isn't a real date. */
export function parseBirthDate(input: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const [, m, d, y] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function ageOn(birthDateIso: string, today: Date = new Date()): number {
  const [y, m, d] = birthDateIso.split('-').map(Number);
  let age = today.getFullYear() - y;
  const beforeBirthday =
    today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}
