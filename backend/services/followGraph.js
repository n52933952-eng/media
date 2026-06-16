import Follow from '../models/follow.js'

const CLIENT_FOLLOW_LIST_CAP = 500

/** Source of truth: Follow collection only. */
export async function getFollowGraphIdsForUser(userId) {
  const uid = userId
  const [followingDocs, followerDocs] = await Promise.all([
    Follow.find({ followerId: uid }).select('followeeId').sort({ createdAt: -1 }).limit(CLIENT_FOLLOW_LIST_CAP).lean(),
    Follow.find({ followeeId: uid }).select('followerId').sort({ createdAt: -1 }).limit(CLIENT_FOLLOW_LIST_CAP).lean(),
  ])

  const following = followingDocs.map((d) => d.followeeId).filter(Boolean)
  const followers = followerDocs.map((d) => d.followerId).filter(Boolean)

  return { following, followers }
}

/** Follower user ids for notifications / live stream. */
export async function getFollowerIdsForUser(userId, limit = 10000) {
  const docs = await Follow.find({ followeeId: userId }).select('followerId').limit(limit).lean()
  return docs.map((d) => d.followerId).filter(Boolean)
}

export async function attachFollowGraphToUser(user) {
  if (!user) return null
  const obj = user.toObject ? user.toObject() : { ...user }
  const { following, followers } = await getFollowGraphIdsForUser(obj._id)
  return { ...obj, following, followers }
}

export async function isViewerFollowingFollowee(viewerId, followeeId) {
  if (!viewerId || !followeeId) return false
  const row = await Follow.findOne({ followerId: viewerId, followeeId })
    .select('_id')
    .lean()
  return !!row
}
