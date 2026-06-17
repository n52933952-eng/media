import { getFeedCacheVersion } from './feedCache.js'
import { redisGet, redisSet } from './redis.js'

const INDEX_TTL_SEC = Number(process.env.FEED_CACHE_TTL_SEC || 45)

/** Normal posts on page 1 (live + pinned are separate). */
export const FEED_FIRST_PAGE_NORMAL_COUNT = 12

export function encodeFeedCursor({ offset, postId, updatedAtMs }) {
  const payload = {
    o: Math.max(0, Number(offset) || 0),
    i: String(postId || ''),
    t: Number(updatedAtMs) || 0,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeFeedCursor(raw) {
  if (raw == null || String(raw).trim() === '') return null
  try {
    const j = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    const offset = Number(j?.o)
    const postId = j?.i != null ? String(j.i) : ''
    const updatedAtMs = Number(j?.t) || 0
    if (!Number.isFinite(offset) || offset < 0) return null
    return { offset, postId, updatedAtMs }
  } catch {
    return null
  }
}

function indexKey(userId, ver) {
  return `feed:nidx:${String(userId)}:${ver}`
}

/** Ordered normal-feed post ids (no live/pinned pseudo rows). */
export async function getStoredFeedNormalIndex(userId) {
  try {
    const ver = await getFeedCacheVersion(userId)
    const raw = await redisGet(indexKey(userId, ver))
    if (!Array.isArray(raw)) return null
    return raw.map(String).filter(Boolean)
  } catch {
    return null
  }
}

export async function storeFeedNormalIndex(userId, postIds) {
  try {
    const ver = await getFeedCacheVersion(userId)
    const ids = (Array.isArray(postIds) ? postIds : []).map(String).filter(Boolean)
    await redisSet(indexKey(userId, ver), ids, INDEX_TTL_SEC)
  } catch {
    /* best-effort */
  }
}
