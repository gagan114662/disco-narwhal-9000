// Locale-stable time/date formatters.
// Avoid Intl / toLocale* in server-rendered components — server and client locales
// can disagree (`PM` vs `p.m.`, AM/PM order, period vs comma) and that
// produces hydration mismatches.

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** HH:MM in 24-hour, UTC-stable. Same string on server and client. */
export function formatTimeOfDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** YYYY-MM-DD, UTC-stable. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

/** YYYY-MM-DD HH:MM, UTC-stable. */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTimeOfDay(iso)}`
}
