import User from '../models/user.js'
import { redisGet, redisSet, redisDel } from './redis.js'

const CACHE_TTL_SEC = Number(process.env.AUTH_USER_CACHE_TTL_SEC || 300) // 5 min
const cacheKey = (userId) => `auth:user:${String(userId)}`

export async function getCachedUserById(userId) {
  const uid = String(userId)
  const cached = await redisGet(cacheKey(uid))
  if (cached?._id) return cached

  const user = await User.findById(uid).select('-password').lean()
  if (!user) return null

  await redisSet(cacheKey(uid), user, CACHE_TTL_SEC)
  return user
}

export async function invalidateUserAuthCache(userId) {
  if (!userId) return
  await redisDel(cacheKey(String(userId)))
}
