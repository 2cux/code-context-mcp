/**
 * Centralized timestamp helpers.
 * All timestamps are ISO 8601 strings in UTC.
 */

export function nowISO(): string {
  return new Date().toISOString();
}

export function isoFromDate(d: Date): string {
  return d.toISOString();
}

export function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}
