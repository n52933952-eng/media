import { getRedis, isRedisAvailable } from '../services/redis.js'

const WINDOW_SEC = Number(process.env.API_RATE_LIMIT_WINDOW_SEC || 60)
const MAX_PER_WINDOW = Number(process.env.API_RATE_LIMIT_MAX || 300)
const AUTH_MAX_PER_WINDOW = Number(process.env.API_AUTH_RATE_LIMIT_MAX || 30)

const shouldSkip = (req) => {
  const p = req.path || ''
  return p === '/health' || p.startsWith('/api/football')
}

const clientKey = (req) => {
  const userId = req.user?._id?.toString?.()
  if (userId) return `user:${userId}`
  const ip =
    req.headers['x-forwarded-for']?.toString?.().split(',')[0]?.trim() ||
    req.ip ||
    'unknown'
  return `ip:${ip}`
}

const checkLimit = async (key, max) => {
  if (!isRedisAvailable()) return { allowed: true, remaining: max }

  const client = getRedis()
  const redisKey = `ratelimit:${key}`
  const count = await client.incr(redisKey)
  if (count === 1) await client.expire(redisKey, WINDOW_SEC)
  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
  }
}

export const apiRateLimit = async (req, res, next) => {
  if (shouldSkip(req)) return next()

  try {
    const isAuthRoute =
      req.path.includes('/login') ||
      req.path.includes('/signup') ||
      req.path.includes('/google')
    const max = isAuthRoute ? AUTH_MAX_PER_WINDOW : MAX_PER_WINDOW
    const key = `${clientKey(req)}:${isAuthRoute ? 'auth' : 'api'}`
    const { allowed, remaining } = await checkLimit(key, max)

    res.setHeader('X-RateLimit-Remaining', String(remaining))
    if (!allowed) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' })
    }
    next()
  } catch {
    next()
  }
}
