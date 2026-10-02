/**
 * Timezone conversion for "when do you listen" views. Spotify records UTC; when the user picks a
 * timezone (by default their browser's), each timestamp is shifted by that zone's real offset at
 * that moment, so daylight saving is handled. This assumes you listened in that timezone.
 */
export function offsetFn(timeZone: string | null): (t: number) => number {
  if (!timeZone || timeZone === 'UTC') return () => 0;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  });
  const cache = new Map<number, number>();
  return (t: number) => {
    const hourKey = Math.floor(t / 3_600_000);
    let off = cache.get(hourKey);
    if (off === undefined) {
      const at = hourKey * 3_600_000;
      const parts = Object.fromEntries(fmt.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
      const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
      off = local - at;
      cache.set(hourKey, off);
    }
    return off;
  };
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
