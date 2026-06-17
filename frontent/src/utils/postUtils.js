/** Comment count: feed uses replyCount; post detail may use replies[]. */
export function getReplyCount(post) {
  if (!post) return 0
  if (typeof post.replyCount === 'number') return post.replyCount
  return Array.isArray(post.replies) ? post.replies.length : 0
}

export function withReplyCountDelta(post, delta) {
  if (!post) return post
  const replies = Array.isArray(post.replies) ? post.replies : []
  return {
    ...post,
    replies,
    replyCount: Math.max(0, getReplyCount(post) + delta),
  }
}

export function followIdToString(f) {
  if (f == null) return ''
  if (typeof f === 'object' && f._id != null) return String(f._id)
  return String(f)
}

export function isFollowingUserId(followingList, targetUserId) {
  if (!targetUserId || !Array.isArray(followingList)) return false
  const id = String(targetUserId)
  return followingList.some((f) => followIdToString(f) === id)
}

/** GET /api/post/:id returns the post document directly (not { post }). */
export function parsePostFromApiResponse(data) {
  if (!data || typeof data !== 'object') return null
  if (data._id) return data
  if (data.post?._id) return data.post
  return null
}

export function postDetailApiUrl(postId) {
  const base = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
  return `${base}/api/post/${postId}`
}
