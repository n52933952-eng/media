import Post from '../models/post.js'
import Follow from '../models/follow.js'
import { dedupeGamePostsForFeed } from '../utils/dedupeGameFeedPosts.js'
import { enrichGoFishPostsForFeed } from '../utils/enrichGoFishFeedPosts.js'
import { hiddenPostQueryFilter } from './feedHiddenPosts.js'
import { getStoredFeedNormalIndex, storeFeedNormalIndex } from './feedCursor.js'
import { attachReplyCountsToPosts } from './commentService.js'

function feedSortTime(post) {
  const boost = post && typeof post.__viewerSortBoostMs === 'number' ? post.__viewerSortBoostMs : 0
  const base = new Date(post?.updatedAt || post?.createdAt || 0).getTime()
  return Math.max(base || 0, boost || 0)
}

function authorIdFromPost(post) {
  const pb = post?.postedBy
  if (!pb) return ''
  return pb._id != null ? pb._id.toString() : String(pb)
}

function hasAnotherContributor(post, authorIdStr) {
  if (!post?.isCollaborative || !Array.isArray(post.contributors)) return false
  return post.contributors.some((c) => {
    const cid = c && c._id != null ? c._id.toString() : String(c)
    return cid && cid !== authorIdStr
  })
}

/** Build ordered list of normal feed post ids (3 newest per followed user + contributor merge). */
export async function buildFeedNormalPostIds(userId, hiddenObjectIds) {
  const hiddenFilter = hiddenPostQueryFilter(hiddenObjectIds)
  const followingDocs = await Follow.find({ followerId: userId })
    .select('followeeId')
    .limit(5000)
    .lean()
  const following = followingDocs.map((d) => d.followeeId)
  const followedUserIds = following.filter((id) => id.toString() !== userId.toString())

  let normalPosts = []
  if (followedUserIds.length > 0) {
    normalPosts = await Post.find({
      $or: [
        { postedBy: { $in: followedUserIds } },
        { isCollaborative: true, contributors: { $in: followedUserIds } },
      ],
      ...hiddenFilter,
    })
      .populate('postedBy', '-password')
      .populate('contributors', 'username profilePic name')
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(followedUserIds.length * 3 + 50)
      .lean()
  }

  const contributorPosts = await Post.find({
    isCollaborative: true,
    contributors: userId,
    ...hiddenFilter,
  })
    .populate('postedBy', '-password')
    .populate('contributors', 'username profilePic name')
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(40)
    .lean()

  const perUserMap = new Map()
  for (const post of normalPosts) {
    const uid = authorIdFromPost(post)
    if (!uid) continue
    if (!perUserMap.has(uid)) perUserMap.set(uid, [])
    if (perUserMap.get(uid).length < 3) perUserMap.get(uid).push(post)
  }
  const cappedNormalPosts = [...perUserMap.values()].flat()

  let allNormalPosts = [...cappedNormalPosts, ...contributorPosts]
  allNormalPosts.sort((a, b) => feedSortTime(b) - feedSortTime(a))

  const uniqueNormalPosts = []
  const seenPostIds = new Set()
  for (const post of allNormalPosts) {
    const postId = post._id.toString()
    if (!seenPostIds.has(postId)) {
      uniqueNormalPosts.push(post)
      seenPostIds.add(postId)
    }
  }

  await enrichGoFishPostsForFeed(uniqueNormalPosts)
  const dedupedNormalPosts = dedupeGamePostsForFeed(uniqueNormalPosts)

  const viewerIdStr = userId.toString()
  const feedNormalPosts = dedupedNormalPosts.filter((post) => {
    const aid = authorIdFromPost(post)
    if (!aid) return false
    if (aid !== viewerIdStr) return true
    return hasAnotherContributor(post, viewerIdStr)
  })

  return {
    following,
    normalIds: feedNormalPosts.map((p) => p._id.toString()),
  }
}

/** Resolve index: use Redis cache when possible; rebuild when missing. */
export async function getFeedNormalIndex(userId, hiddenObjectIds) {
  const cached = await getStoredFeedNormalIndex(userId)
  if (cached?.length) return cached
  const { normalIds } = await buildFeedNormalPostIds(userId, hiddenObjectIds)
  await storeFeedNormalIndex(userId, normalIds)
  return normalIds
}

/** Populate full post docs preserving id order (only ids for this page). */
export async function populateFeedPostsByIds(ids) {
  const wanted = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
  if (!wanted.length) return []
  const docs = await Post.find({ _id: { $in: wanted } })
    .populate('postedBy', '-password')
    .populate('contributors', 'username profilePic name')
    .lean()
  const byId = new Map(docs.map((p) => [String(p._id), p]))
  const ordered = wanted.map((id) => byId.get(id)).filter(Boolean)
  return attachReplyCountsToPosts(ordered)
}

export async function fetchChannelPostsForUser(userId) {
  return Post.find({ channelAddedBy: userId.toString() })
    .populate('postedBy', '-password')
    .populate('contributors', 'username profilePic name')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()
}

export { feedSortTime }
