import Follow from '../models/follow.js'
import User from '../models/user.js'

const CLIENT_FOLLOW_LIST_CAP = 500

/** Source of truth: Follow collection. Legacy User arrays only if Follow rows missing. */
export async function getFollowGraphIdsForUser(userId) {
  const uid = userId
  const [followingDocs, followerDocs] = await Promise.all([
    Follow.find({ followerId: uid }).select('followeeId').sort({ createdAt: -1 }).limit(CLIENT_FOLLOW_LIST_CAP).lean(),
    Follow.find({ followeeId: uid }).select('followerId').sort({ createdAt: -1 }).limit(CLIENT_FOLLOW_LIST_CAP).lean(),
  ])

  let following = followingDocs.map((d) => d.followeeId).filter(Boolean)
  let followers = followerDocs.map((d) => d.followerId).filter(Boolean)

  if (following.length === 0 || followers.length === 0) {
    const legacy = await User.findById(uid).select('following followers').lean()
    if (following.length === 0 && Array.isArray(legacy?.following) && legacy.following.length > 0) {
      following = legacy.following.slice(0, CLIENT_FOLLOW_LIST_CAP)
    }
    if (followers.length === 0 && Array.isArray(legacy?.followers) && legacy.followers.length > 0) {
      followers = legacy.followers.slice(0, CLIENT_FOLLOW_LIST_CAP)
    }
  }

  return { following, followers }
}

/** Follower user ids for notifications / live stream (scalable; no User.followers array). */
export async function getFollowerIdsForUser(userId, limit = 10000) {
  const docs = await Follow.find({ followeeId: userId }).select('followerId').limit(limit).lean()
  const ids = docs.map((d) => d.followerId).filter(Boolean)
  if (ids.length > 0) return ids

  const legacy = await User.findById(userId).select('followers').lean()
  if (!Array.isArray(legacy?.followers) || legacy.followers.length === 0) return []
  return legacy.followers.slice(0, limit)
}

export async function attachFollowGraphToUser(user) {
  if (!user) return null
  const obj = user.toObject ? user.toObject() : { ...user }
  const { following, followers } = await getFollowGraphIdsForUser(obj._id)
  return { ...obj, following, followers }
}

/** Follow collection only — legacy User.followers[] is not updated on unfollow and must not be used here. */
export async function isViewerFollowingFollowee(viewerId, followeeId) {
  if (!viewerId || !followeeId) return false
  const row = await Follow.findOne({ followerId: viewerId, followeeId })
    .select('_id')
    .lean()
  return !!row
}
