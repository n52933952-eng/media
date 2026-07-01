import jwt from 'jsonwebtoken'
import { getCachedUserById } from '../services/userAuthCache.js'

/**
 * Like protectRoute, but never rejects: if a valid token is present it attaches req.user,
 * otherwise it simply continues. Use on public reads that want viewer-specific extras
 * (e.g. `likedByMe`) without forcing authentication.
 */
const optionalAuth = async (req, _res, next) => {
  try {
    const token = req.cookies?.jwt
    if (!token) return next()

    const decode = jwt.verify(token, process.env.JWT_SECRET)
    if (decode?.userId) {
      const user = await getCachedUserById(decode.userId)
      if (user) req.user = user
    }
  } catch (_) {
    // Invalid/expired token → treat as anonymous.
  }
  return next()
}

export default optionalAuth
