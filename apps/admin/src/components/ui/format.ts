// Display formatting shared by every admin screen.

export function formatDate(value: string | Date | null | undefined, withTime = true): string {
  if (!value) return '—'
  const d = new Date(value)

  if (Number.isNaN(d.getTime())) return '—'

  return d.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  const abs = Math.abs(seconds)
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [2592000, 'day'],
    [31536000, 'month'],
    [Infinity, 'year']
  ]
  const div = [1, 60, 3600, 86400, 2592000, 31536000]
  const i = units.findIndex(([limit]) => abs < limit)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  return rtf.format(-Math.round(seconds / div[i]), units[i][1])
}

export function formatMoney(cents: number | null | undefined, currency = 'usd'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format((cents ?? 0) / 100)
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'

  return new Intl.NumberFormat().format(n)
}

/** Plan limit for display: null/Infinity mean unlimited. */
export function formatLimit(v: unknown): string {
  if (v === null || v === Infinity) return 'Unlimited'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'number') return formatNumber(v)

  return String(v ?? '—')
}

/** One entry per UTC day for the last `days` days, 0 where the series has no point. */
export function fillDays(series: Array<{ day: string; value: number }>, days: number): Array<{ day: string; value: number }> {
  const byDay = new Map(series.map(p => [p.day, p.value]))
  const out: Array<{ day: string; value: number }> = []
  const today = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10)

    out.push({ day: d, value: byDay.get(d) ?? 0 })
  }

  return out
}
