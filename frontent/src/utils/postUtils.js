/** Comment count: feed uses replyCount; post detail may use replies[]. */
export const COMMENTS_PAGE_SIZE = 12

export const CHANNEL_USERNAMES = [
  'Football',
  'AlJazeera',
  'NBCNews',
  'BeinSportsNews',
  'SkyNews',
  'Cartoonito',
  'NatGeoKids',
  'SciShowKids',
  'JJAnimalTime',
  'KidsArabic',
  'NatGeoAnimals',
  'MBCDrama',
  'Fox11',
]

export function getYouTubeVideoId(url) {
  if (!url) return ''
  const normalized = String(url).trim()
  const patterns = [
    /youtube\.com\/embed\/([^?&/]+)/i,
    /youtube\.com\/watch\?v=([^?&/]+)/i,
    /youtu\.be\/([^?&/]+)/i,
    /youtube\.com\/shorts\/([^?&/]+)/i,
    /youtube\.com\/live\/([^?&/]+)/i,
    /(?:ytimg\.com|img\.youtube\.com)\/vi\/([^?&/]+)/i,
  ]
  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match?.[1]) return match[1]
  }
  return ''
}

export function isYouTubePost(post) {
  return !!getYouTubeVideoId(post?.img || '')
}

export function isChannelPost(post) {
  if (!post) return false
  if (isYouTubePost(post)) return true
  if (post.channelAddedBy) return true
  const username = post.postedBy?.username
  return !!username && CHANNEL_USERNAMES.includes(username)
}

/** News / YouTube channels: likes only at post level. Football keeps per-match comments. */
export function hideChannelPostComments(post) {
  if (!isChannelPost(post)) return false
  return post?.postedBy?.username !== 'Football'
}

export function getReplyCount(post) {
  if (!post) return 0
  if (typeof post.replyCount === 'number') return post.replyCount
  return Array.isArray(post.replies) ? post.replies.length : 0
}

export function mergeRepliesById(existing, incoming) {
  const map = new Map((existing || []).map((r) => [String(r._id), r]))
  for (const r of incoming || []) map.set(String(r._id), r)
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
}

export function removeReplyAndDescendants(replies, deletedId) {
  const idStr = String(deletedId)
  const toDelete = new Set([idStr])
  let changed = true
  while (changed) {
    changed = false
    for (const r of replies || []) {
      const rId = String(r._id)
      const parent = r?.parentReplyId ? String(r.parentReplyId) : ''
      if (parent && toDelete.has(parent) && !toDelete.has(rId)) {
        toDelete.add(rId)
        changed = true
      }
    }
  }
  return (replies || []).filter((r) => !toDelete.has(String(r._id)))
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

export function postDetailApiUrl(postId, { includeReplies = true } = {}) {
  const base = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
  if (includeReplies) return `${base}/api/post/${postId}`
  return `${base}/api/post/${postId}?includeReplies=0`
}

export function postCommentsApiUrl(
  postId,
  { limit = COMMENTS_PAGE_SIZE, skip = 0, footballMatchId = null } = {},
) {
  const base = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
  const params = new URLSearchParams({ limit: String(limit), skip: String(skip) })
  if (footballMatchId) params.set('footballMatchId', String(footballMatchId))
  return `${base}/api/post/${postId}/comments?${params.toString()}`
}
