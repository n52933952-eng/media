export const NOTIFICATION_PAGE_SIZE = Math.min(
  50,
  Math.max(10, parseInt(process.env.NOTIFICATION_PAGE_SIZE || '12', 10) || 12),
)

export function encodeNotificationCursor({ createdAt, id }) {
  const payload = {
    t: new Date(createdAt).getTime(),
    i: String(id || ''),
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeNotificationCursor(raw) {
  if (raw == null || String(raw).trim() === '') return null
  try {
    const j = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    const t = Number(j?.t)
    const id = j?.i != null ? String(j.i) : ''
    if (!Number.isFinite(t) || !id) return null
    return { createdAt: new Date(t), id }
  } catch {
    return null
  }
}
