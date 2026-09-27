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

/**
 * Same-country random users. $sample after an indexed country match.
 * Followed users are filtered in memory so we do not put 5k ids in $nin.
 */
export async function sampleDiscoverUsers(userId, { country, size = 12 } = {}) {
  const want = Math.min(Math.max(Number(size) || 12, 1), 20)
  const viewerOid = new mongoose.Types.ObjectId(userId)
  const countryName = String(country || '').trim()
  if (!countryName) return []

  const following = await followedIdSet(userId)
  const match = {
    _id: { $ne: viewerOid },
    username: { $nin: SYSTEM_USERNAMES },
    country: countryName,
  }

  let pool = await User.aggregate([
    { $match: match },
    { $sample: { size: Math.min(want * 4, 60) } },
    { $project: { username: 1, name: 1, profilePic: 1, country: 1 } },
  ])

  if (pool.length === 0) {
    pool = await User.aggregate([
      {
        $match: {
          _id: { $ne: viewerOid },
          username: { $nin: SYSTEM_USERNAMES },
          country: { $regex: new RegExp(`^${escapeRegex(countryName)}$`, 'i') },
        },
      },
      { $sample: { size: Math.min(want * 4, 60) } },
      { $project: { username: 1, name: 1, profilePic: 1, country: 1 } },
    ])
  }

  return pool.filter((u) => !following.has(String(u._id))).slice(0, want)
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

export { USER_PREVIEW }
