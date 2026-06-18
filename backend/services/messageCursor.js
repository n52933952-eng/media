/** Cursor pagination for chat messages (sorted by createdAt desc, _id desc). */

export const MESSAGES_PAGE_SIZE_DEFAULT = 12

const OID_HEX = /^[0-9a-fA-F]{24}$/

export function encodeMessageCursor({ messageId, createdAtMs }) {
  const payload = {
    i: String(messageId || ''),
    t: Number(createdAtMs) || 0,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeMessageCursor(raw) {
  if (raw == null || String(raw).trim() === '') return null
  try {
    const j = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    const messageId = j?.i != null ? String(j.i) : ''
    const createdAtMs = Number(j?.t) || 0
    if (!OID_HEX.test(messageId)) return null
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null
    return { messageId, createdAtMs }
  } catch {
    return null
  }
}
