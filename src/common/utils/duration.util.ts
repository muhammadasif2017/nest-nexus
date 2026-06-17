const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

// Parses strings like "15m", "7d" into a future Date. Falls back to fallbackMs from now if unparseable.
export function parseExpiryDate(duration: string, fallbackMs: number): Date {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return new Date(Date.now() + fallbackMs);
  const [, amount, unit] = match;
  return new Date(Date.now() + parseInt(amount, 10) * UNIT_MS[unit]);
}
