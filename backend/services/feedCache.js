import { getRedis, redisGet, redisSet } from './redis.js'

const TTL_SEC = Number(process.env.FEED_CACHE_TTL_SEC || 45)

const versionKey = (userId) => `feed:ver:${String(userId)}`
const cacheKey = (userId, skip, limit, ver) =>
  `feed:${String(userId)}:${ver}:${skip}:${limit}`

export async function getFeedCacheVersion(userId) {
  try {
    const client = getRedis()
    const v = await client.get(versionKey(userId))
    return v ? String(v) : '0'
  } catch {
    return '0'
  }
}

export async function getCachedFeed(userId, skip, limit) {
  try {
    const ver = await getFeedCacheVersion(userId)
    const key = cacheKey(userId, skip, limit, ver)
    return redisGet(key)
  } catch {
    return null
  }
}

export async function setCachedFeed(userId, skip, limit, payload) {
  try {
    const ver = await getFeedCacheVersion(userId)
    const key = cacheKey(userId, skip, limit, ver)
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
