import Follow from '../models/follow.js'
import Post from '../models/post.js'
import User from '../models/user.js'
import { findRecentDiscoverPosts } from './discoverUsers.js'
import { populateFeedPostsByIds } from './feedAssembly.js'

const SUGGEST_EVERY = 5
const STOP = new Set([
  'this', 'that', 'with', 'from', 'have', 'your', 'just', 'about', 'like',
  'they', 'what', 'when', 'will', 'been', 'were', 'them', 'then', 'some',
  'more', 'also', 'here', 'there', 'would', 'could', 'should', 'http',
  'https', 'www', 'post', 'photo', 'video', 'love', 'good', 'best',
])

function authorCountry(post) {
  return String(post?.postedBy?.country || '').trim().toLowerCase()
}

function scoreRelated(text, tokens) {
  if (!tokens.length) return 0
  const hay = String(text || '').toLowerCase()
  let n = 0
  for (const tok of tokens) {
    if (hay.includes(tok)) n += 1
  }
  return n
}

/** Soft related words from recent followed posts. Not a strict topic match. */
async function followedInterestTokens(userId) {
  const docs = await Follow.find({ followerId: userId }).select('followeeId').limit(200).lean()
  const ids = docs.map((d) => d.followeeId).filter(Boolean)
  if (!ids.length) return []
  const posts = await Post.find({
    postedBy: { $in: ids },
    text: { $type: 'string', $nin: ['', null] },
  })
    .select('text')
    .sort({ createdAt: -1 })
    .limit(40)
    .lean()
  const counts = new Map()
  for (const p of posts) {
    const words = String(p.text || '').toLowerCase().match(/[a-zA-Z\u0600-\u06FF]{4,}/g) || []
    for (const w of words) {
      if (STOP.has(w)) continue
      counts.set(w, (counts.get(w) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w]) => w)
}

/** Extra posts from unfollowed users. Country + related text first, then worldwide. Never writes into the follow index. */
export async function fetchSuggestedFeedPosts(userId, { count = 3, hiddenObjectIds = [], excludePostIds = new Set() } = {}) {
  const want = Math.min(Math.max(Number(count) || 3, 0), 12)
  if (!want) return []
  const me = await User.findById(userId).select('country').lean()
  const country = String(me?.country || '').trim()

  const [candidates, tokens] = await Promise.all([
    findRecentDiscoverPosts(userId, {
      limit: Math.min(want * 8, 80),
      hiddenObjectIds,
      excludePostIds,
    }),
    followedInterestTokens(userId),
  ])
  if (!candidates.length) return []

  const countryKey = country.toLowerCase()
  candidates.sort((a, b) => {
    const relA = scoreRelated(a?.text, tokens)
    const relB = scoreRelated(b?.text, tokens)
    const locA = countryKey && authorCountry(a) === countryKey ? 2 : 0
    const locB = countryKey && authorCountry(b) === countryKey ? 2 : 0
    return (relB + locB) - (relA + locA)
  })
  const picked = candidates.slice(0, want)
  return populateFeedPostsByIds(picked.map((p) => String(p._id)))
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
