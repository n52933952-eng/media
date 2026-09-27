import mongoose from 'mongoose'
import User from '../models/user.js'
import Post from '../models/post.js'
import Follow from '../models/follow.js'
import { LIVE_CHANNELS } from '../config/channels.js'
import { hiddenPostQueryFilter } from './feedHiddenPosts.js'

const SYSTEM_USERNAMES = [
  'Football',
  'Weather',
  ...LIVE_CHANNELS.map((channel) => channel.username),
  'SkySportsNews',
]

const USER_PREVIEW = 'username name profilePic country'

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function followedIdSet(userId) {
  const docs = await Follow.find({ followerId: userId }).select('followeeId').limit(5000).lean()
  const set = new Set()
  for (const d of docs) {
    const id = d.followeeId != null ? String(d.followeeId) : ''
    if (id) set.add(id)
  }
  return set
}

async function sampleUnfollowed(userId, viewerOid, following, extraMatch, want) {
  const pool = await User.aggregate([
    {
      $match: {
        _id: { $ne: viewerOid },
        username: { $nin: SYSTEM_USERNAMES },
        ...extraMatch,
      },
    },
    { $sample: { size: Math.min(want * 4, 60) } },
    { $project: { username: 1, name: 1, profilePic: 1, country: 1 } },
  ])
  return pool.filter((u) => !following.has(String(u._id)))
}

/**
 * Random users: same country first, then worldwide if that pool is short.
 * $sample after an indexed country match. Followed users filtered in memory.
 */
export async function sampleDiscoverUsers(userId, { country, size = 12, allowWorldwide = true } = {}) {
  const want = Math.min(Math.max(Number(size) || 12, 1), 20)
  const viewerOid = new mongoose.Types.ObjectId(userId)
  const countryName = String(country || '').trim()
  const following = await followedIdSet(userId)

  let picked = []
  if (countryName) {
    picked = await sampleUnfollowed(userId, viewerOid, following, { country: countryName }, want)
    if (picked.length === 0) {
      picked = await sampleUnfollowed(
        userId,
        viewerOid,
        following,
        { country: { $regex: new RegExp(`^${escapeRegex(countryName)}$`, 'i') } },
        want,
      )
    }
  }

  if (picked.length < want && allowWorldwide) {
    const more = await sampleUnfollowed(userId, viewerOid, following, {}, want)
    const have = new Set(picked.map((u) => String(u._id)))
    for (const u of more) {
      if (have.has(String(u._id))) continue
      picked.push(u)
      if (picked.length >= want) break
    }
  }

  return picked.slice(0, want)
}

/** One latest normal post preview per user (uses postedBy + createdAt index). */
export async function attachLatestPostPreviews(users, hiddenObjectIds = []) {
  if (!Array.isArray(users) || users.length === 0) return []
  const ids = users
    .map((u) => u._id)
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(id))
  if (!ids.length) return users.map((u) => ({ ...u, latestPost: null }))

  const hidden = hiddenPostQueryFilter(hiddenObjectIds)
  const rows = await Post.aggregate([
    {
      $match: {
        postedBy: { $in: ids },
        hiddenByAdmin: { $ne: true },
        ...hidden,
        $or: [
          { channelAddedBy: { $exists: false } },
          { channelAddedBy: null },
          { channelAddedBy: '' },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$postedBy',
        postId: { $first: '$_id' },
        text: { $first: '$text' },
        img: { $first: '$img' },
        images: { $first: '$images' },
        createdAt: { $first: '$createdAt' },
      },
    },
  ])

  const byAuthor = new Map(rows.map((r) => [String(r._id), r]))
  return users.map((u) => {
    const row = byAuthor.get(String(u._id))
    return {
      ...u,
      latestPost: row
        ? {
            _id: row.postId,
            text: row.text || '',
            img: row.img || (Array.isArray(row.images) ? row.images[0] : '') || '',
            createdAt: row.createdAt,
          }
        : null,
    }
  })
}

export async function latestPostIdsForUsers(userIds, hiddenObjectIds = []) {
  if (!Array.isArray(userIds) || userIds.length === 0) return []
  const ids = userIds
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(id))
  if (!ids.length) return []
  const hidden = hiddenPostQueryFilter(hiddenObjectIds)
  const rows = await Post.aggregate([
    {
      $match: {
        postedBy: { $in: ids },
        hiddenByAdmin: { $ne: true },
        ...hidden,
        $or: [
          { channelAddedBy: { $exists: false } },
          { channelAddedBy: null },
          { channelAddedBy: '' },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$postedBy', postId: { $first: '$_id' } } },
  ])
  return rows.map((r) => String(r.postId)).filter(Boolean)
}

export function hasVisiblePostContent(p) {
  if (String(p?.text || '').trim()) return true
  if (String(p?.img || '').trim()) return true
  if (Array.isArray(p?.images) && p.images.some((u) => String(u || '').trim())) return true
  return false
}

const CONTENT_MATCH = {
  $or: [
    { img: { $type: 'string', $nin: ['', null] } },
    { 'images.0': { $exists: true } },
    { text: { $type: 'string', $nin: ['', null] } },
  ],
}

/** Recent real posts from people you do not follow. Skips empty signup accounts. */
export async function findRecentDiscoverPosts(userId, { limit = 80, hiddenObjectIds = [], excludePostIds = new Set() } = {}) {
  const following = await followedIdSet(userId)
  following.add(String(userId))
  const hidden = hiddenPostQueryFilter(hiddenObjectIds)
  const rows = await Post.find({
    ...hidden,
    $and: [
      {
        $or: [
          { channelAddedBy: { $exists: false } },
          { channelAddedBy: null },
          { channelAddedBy: '' },
        ],
      },
      CONTENT_MATCH,
      { hiddenByAdmin: { $ne: true } },
    ],
  })
    .select('_id postedBy text img images createdAt')
    .sort({ createdAt: -1 })
    .limit(150)
    .populate('postedBy', 'username name profilePic country')
    .lean()

  const seenAuthor = new Set()
  const out = []
  for (const p of rows) {
    if (excludePostIds.has(String(p._id))) continue
    if (!hasVisiblePostContent(p)) continue
    const authorId = p.postedBy?._id != null ? String(p.postedBy._id) : ''
    if (!authorId || following.has(authorId) || seenAuthor.has(authorId)) continue
    if (p.postedBy?.username && SYSTEM_USERNAMES.includes(p.postedBy.username)) continue
    seenAuthor.add(authorId)
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}

export { USER_PREVIEW }
