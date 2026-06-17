import mongoose from 'mongoose'
import Comment from '../models/comment.js'
import Post, { MAX_REPLIES_PER_POST } from '../models/post.js'

export function formatCommentForApi(doc) {
  if (!doc) return null
  const d = doc.toObject ? doc.toObject() : doc
  return {
    _id: d._id,
    userId: d.userId,
    text: d.text,
    username: d.username,
    userProfilePic: d.userProfilePic,
    date: d.date,
    parentReplyId: d.parentReplyId ?? null,
    likes: Array.isArray(d.likes) ? d.likes : [],
    mentionedUser: d.mentionedUser ?? null,
    footballMatchId: d.footballMatchId ?? null,
  }
}

export async function getCommentCountForPost(postId) {
  const pid = String(postId)
  const post = await Post.findById(pid).select('replyCount replies').lean()
  if (!post) return 0
  if (typeof post.replyCount === 'number' && post.replyCount >= 0) {
    const embeddedLen = Array.isArray(post.replies) ? post.replies.length : 0
    if (embeddedLen > post.replyCount) return embeddedLen
    return post.replyCount
  }
  const n = await Comment.countDocuments({ postId: pid })
  if (n > 0) return n
  return Array.isArray(post.replies) ? post.replies.length : 0
}

export async function getReplyCountsMap(postIds) {
  const ids = [...new Set((postIds || []).map(String).filter(Boolean))]
  const map = new Map()
  if (!ids.length) return map

  const agg = await Comment.aggregate([
    { $match: { postId: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: '$postId', count: { $sum: 1 } } },
  ])
  for (const row of agg) {
    map.set(String(row._id), row.count)
  }

  const posts = await Post.find({ _id: { $in: ids } })
    .select('_id replyCount replies')
    .lean()
  for (const p of posts) {
    const pid = String(p._id)
    const fromComments = map.get(pid) || 0
    const embedded = Array.isArray(p.replies) ? p.replies.length : 0
    const stored = typeof p.replyCount === 'number' ? p.replyCount : 0
    map.set(pid, Math.max(fromComments, embedded, stored))
  }
  return map
}

/** Attach replyCount to feed/profile posts; omit heavy replies[] payload. */
export async function attachReplyCountsToPosts(posts) {
  if (!Array.isArray(posts) || !posts.length) return posts
  const ids = posts.map((p) => p?._id).filter(Boolean)
  const counts = await getReplyCountsMap(ids)
  return posts.map((p) => {
    const pid = String(p._id)
    const count = counts.get(pid) ?? 0
    return { ...p, replyCount: count, replies: [] }
  })
}

export async function getCommentsForPost(postId) {
  const pid = String(postId)
  const docs = await Comment.find({ postId: pid }).sort({ date: 1 }).lean()
  if (docs.length) return docs.map(formatCommentForApi)

  const post = await Post.findById(pid).select('replies').lean()
  if (!Array.isArray(post?.replies) || !post.replies.length) return []
  return post.replies.map((r) => formatCommentForApi(r))
}

export async function attachRepliesToPost(post) {
  if (!post) return post
  const obj = post.toObject ? post.toObject() : { ...post }
  obj.replies = await getCommentsForPost(obj._id)
  if (obj.replyCount == null) obj.replyCount = obj.replies.length
  return obj
}

export async function assertCanAddComment(postId) {
  const count = await getCommentCountForPost(postId)
  if (count >= MAX_REPLIES_PER_POST) {
    const err = new Error('This post has reached the maximum number of comments.')
    err.status = 400
    throw err
  }
}

export async function createComment({
  postId,
  userId,
  username,
  userProfilePic,
  text,
  parentReplyId = null,
  mentionedUser = null,
  footballMatchId = null,
}) {
  await assertCanAddComment(postId)

  const doc = await Comment.create({
    postId,
    userId,
    username,
    userProfilePic,
    text,
    parentReplyId: parentReplyId || null,
    mentionedUser: mentionedUser || null,
    footballMatchId: footballMatchId || null,
    date: new Date(),
    likes: [],
  })

  await Post.findByIdAndUpdate(postId, {
    $inc: { replyCount: 1 },
    $set: { updatedAt: new Date() },
  })

  return formatCommentForApi(doc)
}

export async function findCommentById(commentId, postId) {
  const cid = String(commentId)
  let doc = await Comment.findOne({ _id: cid, postId: String(postId) })
  if (doc) return doc

  const post = await Post.findById(postId).select('replies')
  if (!post?.replies?.id) return null
  return post.replies.id(cid)
}

async function collectDescendantCommentIds(postId, rootId) {
  const all = await Comment.find({ postId: String(postId) }).select('_id parentReplyId').lean()
  if (!all.length) return [String(rootId)]

  const byParent = new Map()
  for (const c of all) {
    const parent = c.parentReplyId ? String(c.parentReplyId) : ''
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(String(c._id))
  }

  const out = new Set([String(rootId)])
  const stack = [String(rootId)]
  while (stack.length) {
    const cur = stack.pop()
    const kids = byParent.get(cur) || []
    for (const kid of kids) {
      if (!out.has(kid)) {
        out.add(kid)
        stack.push(kid)
      }
    }
  }
  return [...out]
}

export async function deleteCommentTree(postId, commentId) {
  const ids = await collectDescendantCommentIds(postId, commentId)
  const embeddedPost = await Post.findById(postId).select('replies')
  let deletedEmbedded = 0
  if (embeddedPost?.replies?.length) {
    for (const id of ids) {
      const sub = embeddedPost.replies.id(id)
      if (sub) {
        embeddedPost.replies.pull(id)
        deletedEmbedded++
      }
    }
    if (deletedEmbedded) {
      await embeddedPost.save({ timestamps: false })
    }
  }

  const result = await Comment.deleteMany({ _id: { $in: ids }, postId: String(postId) })
  const deleted = Math.max(result.deletedCount || 0, ids.length, deletedEmbedded)

  if (deleted > 0) {
    await Post.findByIdAndUpdate(
      postId,
      { $inc: { replyCount: -deleted } },
      { timestamps: false },
    )
  }
  return deleted
}

export async function toggleCommentLike(postId, commentId, userId) {
  const doc = await Comment.findOne({ _id: commentId, postId: String(postId) })
  if (doc) {
    const likes = Array.isArray(doc.likes) ? doc.likes.map(String) : []
    const uid = String(userId)
    const isLiked = likes.includes(uid)
    if (isLiked) {
      doc.likes = doc.likes.filter((l) => String(l) !== uid)
    } else {
      doc.likes.push(userId)
    }
    await doc.save()
    return { doc, isLiked: !isLiked, likesCount: doc.likes.length }
  }

  const post = await Post.findById(postId)
  const reply = post?.replies?.id?.(commentId)
  if (!reply) return null
  if (!reply.likes) reply.likes = []
  const isLiked = reply.likes.some((l) => String(l) === String(userId))
  if (isLiked) reply.likes.pull(userId)
  else reply.likes.push(userId)
  await post.save()
  return { doc: reply, isLiked: !isLiked, likesCount: reply.likes.length }
}

export async function updateCommentDenormForUser(userId, { username, profilePic }) {
  const $set = {}
  if (username != null) $set.username = username
  if (profilePic != null) $set.userProfilePic = profilePic
  if (!Object.keys($set).length) return
  await Comment.updateMany({ userId }, { $set })
}

export async function deleteCommentsForPost(postId) {
  await Comment.deleteMany({ postId: String(postId) })
}

export async function deleteCommentsByUser(userId) {
  await Comment.deleteMany({ userId })
}

export async function getUserCommentsPaginated(userId, { limit = 20, skip = 0 }) {
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
  const skipNum = Math.max(parseInt(skip, 10) || 0, 0)

  const [docs, total] = await Promise.all([
    Comment.find({ userId })
      .sort({ date: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean(),
    Comment.countDocuments({ userId }),
  ])

  if (docs.length) {
    const postIds = [...new Set(docs.map((d) => String(d.postId)))]
    const posts = await Post.find({ _id: { $in: postIds } })
      .populate('postedBy', 'name username profilePic')
      .lean()
    const postMap = new Map(posts.map((p) => [String(p._id), p]))

    const comments = docs.map((d) => ({
      ...formatCommentForApi(d),
      post: postMap.get(String(d.postId))
        ? {
            _id: postMap.get(String(d.postId))._id,
            text: postMap.get(String(d.postId)).text,
            img: postMap.get(String(d.postId)).img,
            postedBy: postMap.get(String(d.postId)).postedBy,
            createdAt: postMap.get(String(d.postId)).createdAt,
          }
        : null,
    }))

    return { comments, total, hasMore: skipNum + limitNum < total }
  }

  return getUserCommentsFromEmbeddedFallback(userId, { limit: limitNum, skip: skipNum })
}

async function getUserCommentsFromEmbeddedFallback(userId, { limit, skip }) {
  const posts = await Post.find({ 'replies.userId': userId })
    .populate('postedBy', 'name username profilePic')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean()

  const allComments = []
  for (const post of posts) {
    for (const reply of post.replies || []) {
      if (String(reply.userId) === String(userId)) {
        allComments.push({
          ...formatCommentForApi(reply),
          post: {
            _id: post._id,
            text: post.text,
            img: post.img,
            postedBy: post.postedBy,
            createdAt: post.createdAt,
          },
        })
      }
    }
  }
  allComments.sort((a, b) => new Date(b.date) - new Date(a.date))
  const paginatedComments = allComments.slice(skip, skip + limit)
  return {
    comments: paginatedComments,
    total: allComments.length,
    hasMore: allComments.length > skip + limit,
  }
}

export async function findCommentThreadRoot(commentId, postId) {
  let current = await findCommentById(commentId, postId)
  if (!current) return null
  let guard = 0
  while (current?.parentReplyId && guard < 50) {
    const parent = await findCommentById(current.parentReplyId, postId)
    if (!parent) break
    current = parent
    guard++
  }
  return current
}
