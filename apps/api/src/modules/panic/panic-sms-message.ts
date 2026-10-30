/** Staff SMS deliberately omits guard identity and location. */
export function buildStaffPanicSms(siteName: string, triggeredAt: Date, timezone: string): string {
  const name = siteName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, 70);
  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(triggeredAt);
  return `Garita: alerta de panico en ${name}, ${time}. Abri el panel.`;
}
