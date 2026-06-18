/** Cursor pagination for conversation list (sorted by updatedAt desc, _id desc). */

export const CONVERSATIONS_PAGE_SIZE_DEFAULT = 8

const OID_HEX = /^[0-9a-fA-F]{24}$/

export function encodeConversationCursor({ conversationId, updatedAtMs }) {
  const payload = {
    i: String(conversationId || ''),
    t: Number(updatedAtMs) || 0,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeConversationCursor(raw) {
  if (raw == null || String(raw).trim() === '') return null
  try {
    const j = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    const conversationId = j?.i != null ? String(j.i) : ''
    const updatedAtMs = Number(j?.t) || 0
    if (!OID_HEX.test(conversationId)) return null
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null
    return { conversationId, updatedAtMs }
  } catch {
    return null
  }
}
