import User from '../models/user.js'
import { sampleDiscoverUsers, latestPostIdsForUsers } from './discoverUsers.js'
import { populateFeedPostsByIds } from './feedAssembly.js'

const SUGGEST_EVERY = 5

/** Extra posts from unfollowed same-country users. Never writes into the follow index. */
export async function fetchSuggestedFeedPosts(userId, { count = 3, hiddenObjectIds = [], excludePostIds = new Set() } = {}) {
  const want = Math.min(Math.max(Number(count) || 3, 0), 12)
  if (!want) return []
  const me = await User.findById(userId).select('country').lean()
  const country = String(me?.country || '').trim()
  if (!country) return []

  const users = await sampleDiscoverUsers(userId, { country, size: want })
  const ids = await latestPostIdsForUsers(
    users.map((u) => u._id),
    hiddenObjectIds,
  )
  const fresh = ids.filter((id) => !excludePostIds.has(String(id)))
  if (!fresh.length) return []
  return populateFeedPostsByIds(fresh.slice(0, want))
}

/** Keep live rows first. Fill an empty home, or insert 1 suggested every 5 followed posts. */
export function mergeSuggestedIntoFeed(posts, suggested) {
  const extras = (Array.isArray(suggested) ? suggested : []).map((p) => ({ ...p, isSuggested: true }))
  if (!extras.length) return Array.isArray(posts) ? posts : []
  const list = Array.isArray(posts) ? posts : []
  const live = []
  const rest = []
  for (const p of list) {
    if (p?.isLive) live.push(p)
    else rest.push(p)
  }
  if (rest.length === 0) return [...live, ...extras]

  const out = [...live]
  let si = 0
  for (let i = 0; i < rest.length; i++) {
    out.push(rest[i])
    if ((i + 1) % SUGGEST_EVERY === 0 && si < extras.length) {
      out.push(extras[si++])
    }
  }
  if (rest.length < SUGGEST_EVERY) {
    while (si < extras.length) out.push(extras[si++])
  }
  return out
}
