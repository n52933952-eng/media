/** Treat ISO datetimes with no timezone as UTC (Mongo/JSON sometimes drop the Z). */
export function parseServerDate(value) {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const raw = String(value).trim()
  if (!raw) return null
  const noTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/
  const d = new Date(noTimezone.test(raw) ? `${raw}Z` : raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Same small stamp as mobile chat: "13 Sep 2:30 PM" in the viewer's local time. */
export function formatChatStamp(value) {
  const d = parseServerDate(value)
  if (!d) return ''
  const date = d.toLocaleDateString([], { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}
