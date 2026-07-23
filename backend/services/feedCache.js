import { getRedis, redisGet, redisSet } from './redis.js'

const TTL_SEC = Number(process.env.FEED_CACHE_TTL_SEC || 45)

const versionKey = (userId) => `feed:ver:${String(userId)}`
/** pageKey: "0" for first page, cursor string, or legacy skip number. */
const cacheKey = (userId, pageKey, limit, ver) =>
  `feed:${String(userId)}:${ver}:${String(pageKey)}:${limit}`

export async function getFeedCacheVersion(userId) {
  try {
    const client = getRedis()
    const v = await client.get(versionKey(userId))
    return v ? String(v) : '0'
  } catch {
    return '0'
  }
}

export async function getCachedFeed(userId, pageKey, limit) {
  try {
    const ver = await getFeedCacheVersion(userId)
    const key = cacheKey(userId, pageKey, limit, ver)
    return redisGet(key)
  } catch {
    return null
  }
}

export async function setCachedFeed(userId, pageKey, limit, payload) {
  try {
    const ver = await getFeedCacheVersion(userId)
    const key = cacheKey(userId, pageKey, limit, ver)
    await redisSet(key, payload, TTL_SEC)
  } catch {
    /* best-effort */
  }
}

/** Bump version so all cached pages for this user are ignored. */
export async function invalidateUserFeedCache(userId) {
  if (!userId) return
  try {
    const client = getRedis()
    await client.incr(versionKey(userId))
  } catch {
    /* best-effort */
  }
}

/** Batch cache bust — one Redis pipeline, O(n) INCR but not O(n) round-trips. */
export async function invalidateUserFeedCaches(userIds) {
  const unique = [
    ...new Set(
      (userIds || [])
        .map((id) => (id != null ? String(id) : ''))
        .filter(Boolean),
    ),
  ]
  if (!unique.length) return
  try {
    const client = getRedis()
    const pipeline = client.pipeline()
    for (const uid of unique) pipeline.incr(versionKey(uid))
    await pipeline.exec()
  } catch {
    /* best-effort */
  }
}
