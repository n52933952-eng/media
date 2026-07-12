import mongoose from 'mongoose'
import Comment from '../models/comment.js'
import Post, { MAX_REPLIES_PER_POST } from '../models/post.js'

/** Only fields needed for comment list UI — keeps Mongo payload small. */
const COMMENT_LIST_SELECT =
  '_id userId text username name userProfilePic date parentReplyId likes mentionedUser footballMatchId'

function toObjectId(value) {
  const s = String(value)
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null
}

function buildRootCommentQuery(postId, footballMatchId = null) {
  const oid = toObjectId(postId)
  const query = {
    postId: oid || String(postId),
    $or: [{ parentReplyId: null }, { parentReplyId: { $exists: false } }],
  }
  if (footballMatchId) {
    query.footballMatchId = String(footballMatchId)
  }
  return query
}

export function formatCommentForApi(doc) {
  if (!doc) return null
  const d = doc.toObject ? doc.toObject() : doc
  return {
    _id: d._id,
    userId: d.userId,
    text: d.text,
    username: d.username,
    name: d.name || '',
    userProfilePic: d.userProfilePic,
    date: d.date,
    parentReplyId: d.parentReplyId ?? null,
    likes: Array.isArray(d.likes) ? d.likes : [],
    mentionedUser: d.mentionedUser ?? null,
    footballMatchId: d.footballMatchId ?? null,
  }
}

/** Fill missing display names from User (older comments only stored username). */
async function enrichCommentNames(comments) {
  if (!Array.isArray(comments) || !comments.length) return comments || []
  const missingIds = [
    ...new Set(
      comments
        .filter((c) => c && !c.name && c.userId)
        .map((c) => String(c.userId)),
    ),
  ]
  if (!missingIds.length) return comments

  const User = (await import('../models/user.js')).default
  const users = await User.find({ _id: { $in: missingIds } })
    .select('name')
    .lean()
  const nameById = new Map(users.map((u) => [String(u._id), u.name || '']))
  return comments.map((c) => {
    if (c?.name || !c?.userId) return c
    const n = nameById.get(String(c.userId))
    return n ? { ...c, name: n } : c
  })
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
  if (docs.length) return enrichCommentNames(docs.map(formatCommentForApi))

  const post = await Post.findById(pid).select('replies').lean()
  if (!Array.isArray(post?.replies) || !post.replies.length) return []
  return enrichCommentNames(post.replies.map((r) => formatCommentForApi(r)))
}

async function getDescendantCommentsForRoots(postId, rootIds) {
  if (!rootIds?.length) return []
  const pid = toObjectId(postId)
  if (!pid) return []

  const rootOids = rootIds.map(toObjectId).filter(Boolean)
  if (!rootOids.length) return []

  const rows = await Comment.aggregate([
    { $match: { _id: { $in: rootOids }, postId: pid } },
    {
      $graphLookup: {
        from: 'comments',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'parentReplyId',
        as: 'descendants',
        maxDepth: 24,
        restrictSearchWithMatch: { postId: pid },
      },
    },
    { $project: { descendants: 1 } },
  ])

  const out = []
  const seen = new Set()
  for (const row of rows) {
    for (const d of row.descendants || []) {
      const id = String(d._id)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(d)
    }
  }
  return out
}

function collectEmbeddedThreadReplies(embedded, roots) {
  const rootIds = new Set(roots.map((r) => String(r._id)))
  const inThread = new Set(rootIds)
  let added = true
  while (added) {
    added = false
    for (const r of embedded) {
      const id = String(r._id)
      if (inThread.has(id)) continue
      const p = r.parentReplyId ? String(r.parentReplyId) : ''
      if (p && inThread.has(p)) {
        inThread.add(id)
        added = true
      }
    }
  }
  return embedded.filter((r) => inThread.has(String(r._id)))
}

/** Paginate top-level comments; each page includes nested replies for those roots. */
export async function getPostCommentsPaginated(
  postId,
  { limit = 12, skip = 0, footballMatchId = null } = {},
) {
  const pid = String(postId)
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50)
  const skipNum = Math.max(parseInt(skip, 10) || 0, 0)
  const rootQuery = buildRootCommentQuery(postId, footballMatchId)

  // Fetch limit+1 to detect hasMore — avoids an expensive countDocuments scan.
  const rootsPlus = await Comment.find(rootQuery)
    .select(COMMENT_LIST_SELECT)
    .sort({ date: 1 })
    .skip(skipNum)
    .limit(limitNum + 1)
    .lean()

  if (!rootsPlus.length && skipNum === 0) {
    const post = await Post.findById(pid).select('replies replyCount').lean()
    const embedded = Array.isArray(post?.replies) ? post.replies : []
    if (!embedded.length) {
      return { replies: [], total: post?.replyCount ?? 0, hasMore: false }
    }

    let topLevel = embedded.filter((r) => !r?.parentReplyId)
    if (footballMatchId) {
      topLevel = topLevel.filter(
        (r) => String(r?.footballMatchId || '') === String(footballMatchId),
      )
    }
    const legacyRoots = topLevel.slice(skipNum, skipNum + limitNum + 1)
    const hasMore = legacyRoots.length > limitNum
    const pageRoots = hasMore ? legacyRoots.slice(0, limitNum) : legacyRoots
    if (!pageRoots.length) {
      return {
        replies: [],
        total: post?.replyCount ?? topLevel.length,
        hasMore: skipNum < topLevel.length,
      }
    }
    const thread = collectEmbeddedThreadReplies(embedded, pageRoots)
    return {
      replies: await enrichCommentNames(thread.map(formatCommentForApi)),
      total: post?.replyCount ?? topLevel.length,
      hasMore: skipNum + pageRoots.length < topLevel.length,
    }
  }

  const hasMore = rootsPlus.length > limitNum
  const roots = hasMore ? rootsPlus.slice(0, limitNum) : rootsPlus

  if (!roots.length) {
    return { replies: [], total: 0, hasMore: false }
  }

  const rootIds = roots.map((r) => String(r._id))
  const descendants = await getDescendantCommentsForRoots(pid, rootIds)
  const seen = new Set()
  const merged = []
  for (const doc of [...roots, ...descendants]) {
    const id = String(doc._id)
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(formatCommentForApi(doc))
  }
  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  return {
    replies: await enrichCommentNames(merged),
    total: null,
    hasMore,
  }
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
  name,
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
    name: name || '',
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

export async function updateCommentDenormForUser(userId, { username, name, profilePic }) {
  const $set = {}
  if (username != null) $set.username = username
  if (name != null) $set.name = name
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
