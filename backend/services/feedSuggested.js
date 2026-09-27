import Follow from '../models/follow.js'
import Post from '../models/post.js'
import User from '../models/user.js'
import { findRecentDiscoverPosts, sampleDiscoverUsers, attachLatestPostPreviews } from './discoverUsers.js'
import { populateFeedPostsByIds } from './feedAssembly.js'
import { redisGet, redisSet, redisDel } from './redis.js'

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

const SEEN_TTL_SEC = 30 * 60
const SEEN_MAX = 40
const seenKey = (userId) => `feed:suggest:seen:${String(userId)}`

async function getSeenSuggestedIds(userId) {
  try {
    const raw = await redisGet(seenKey(userId))
    if (Array.isArray(raw)) return new Set(raw.map(String).filter(Boolean))
    return new Set()
  } catch {
    return new Set()
  }
}

export async function resetSuggestedSeen(userId) {
  try {
    await redisDel(seenKey(userId))
  } catch {
    /* best-effort */
  }
}

async function rememberSuggestedIds(userId, ids) {
  const next = [...new Set(ids.map(String).filter(Boolean))].slice(0, SEEN_MAX)
  if (!next.length) return
  try {
    const prev = await getSeenSuggestedIds(userId)
    const merged = [...next, ...prev].filter((id, i, arr) => arr.indexOf(id) === i).slice(0, SEEN_MAX)
    await redisSet(seenKey(userId), merged, SEEN_TTL_SEC)
  } catch {
    /* best-effort */
  }
}

function shufflePick(items, want) {
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy.slice(0, want)
}

/** Extra posts from unfollowed users. Country + related text first, then a fresh shuffle. Never writes into the follow index. */
export async function fetchSuggestedFeedPosts(userId, { count = 3, hiddenObjectIds = [], excludePostIds = new Set() } = {}) {
  const want = Math.min(Math.max(Number(count) || 3, 0), 24)
  if (!want) return []
  const me = await User.findById(userId).select('country').lean()
  const country = String(me?.country || '').trim()

  const fillEmpty = want >= 8
  const [recent, tokens, seen] = await Promise.all([
    findRecentDiscoverPosts(userId, {
      limit: fillEmpty ? 80 : Math.min(Math.max(want * 10, 40), 80),
      hiddenObjectIds,
      excludePostIds,
      maxPerAuthor: fillEmpty ? 4 : 1,
      scan: fillEmpty ? 2000 : 200,
    }),
    followedInterestTokens(userId),
    getSeenSuggestedIds(userId),
  ])
  const candidates = [...recent]
  if (candidates.length < want) {
    const users = await sampleDiscoverUsers(userId, {
      country,
      size: Math.max(want * 2, 24),
      allowWorldwide: true,
    })
    const withPosts = await attachLatestPostPreviews(users, hiddenObjectIds)
    const have = new Set(candidates.map((p) => String(p._id)))
    for (const u of withPosts) {
      const lp = u.latestPost
      if (!lp?._id || have.has(String(lp._id)) || excludePostIds.has(String(lp._id))) continue
      if (!String(lp.img || '').trim() && !String(lp.text || '').trim()) continue
      have.add(String(lp._id))
      candidates.push({
        _id: lp._id,
        text: lp.text,
        img: lp.img,
        createdAt: lp.createdAt,
        postedBy: {
          _id: u._id,
          username: u.username,
          name: u.name,
          profilePic: u.profilePic,
          country: u.country,
        },
      })
      if (candidates.length >= want * 3) break
    }
  }
  if (!candidates.length) return []

  const countryKey = country.toLowerCase()
  candidates.sort((a, b) => {
    const relA = scoreRelated(a?.text, tokens)
    const relB = scoreRelated(b?.text, tokens)
    const locA = countryKey && authorCountry(a) === countryKey ? 2 : 0
    const locB = countryKey && authorCountry(b) === countryKey ? 2 : 0
    return (relB + locB) - (relA + locA)
  })

  const unseen = candidates.filter((p) => !seen.has(String(p._id)))
  const pool = unseen.length >= want ? unseen : candidates
  const top = pool.slice(0, Math.min(pool.length, Math.max(want * 6, 18)))
  const picked = shufflePick(top, want)
  await rememberSuggestedIds(userId, picked.map((p) => String(p._id)))
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
  while (si < extras.length) out.push(extras[si++])
  return out
}
