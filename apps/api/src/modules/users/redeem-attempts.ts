export function purgeExpiredRedeemAttempts(attempts: Map<string, number>, now = Date.now()): void {
  const currentMinute = Math.floor(now / 60000);
  for (const key of attempts.keys()) {
    const separator = key.lastIndexOf(':');
    const minute = Number(key.slice(separator + 1));
    if (!Number.isFinite(minute) || minute < currentMinute) attempts.delete(key);
  }
}
