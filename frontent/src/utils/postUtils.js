/** Comment count: feed uses replyCount; post detail may use replies[]. */
export const COMMENTS_PAGE_SIZE = 12

/** Google Play listing for PlaySocial mobile app. */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.playsocial'

export function openPlayStore() {
  if (typeof window === 'undefined') return
  window.open(PLAY_STORE_URL, '_blank', 'noopener,noreferrer')
}

/**
 * Latest unique commenters for the feed avatar stack.
 * Prefers API `replyPreview`; falls back to embedded `replies[]` on post detail.
 */
export function getReplyPreviewUsers(post, max = 3) {
  if (Array.isArray(post?.replyPreview) && post.replyPreview.length > 0) {
    return post.replyPreview.slice(0, max)
  }
  const replies = Array.isArray(post?.replies) ? post.replies : []
  const seen = new Set()
  const out = []
  for (let i = replies.length - 1; i >= 0 && out.length < max; i -= 1) {
    const r = replies[i]
    const id = String(r?.userId?._id || r?.userId || r?.username || '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      _id: r.userId,
      username: r.username,
      name: r.name || r.username,
      profilePic: r.userProfilePic || null,
    })
  }
  return out
}

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

function contributorIdStr(c) {
  if (c == null) return ''
  if (typeof c === 'object' && c._id != null) return String(c._id)
  return String(c)
}

/** Merge socket/API post updates without losing populated user fields or stale media. */
export function mergePostUpdate(existing, incoming) {
  if (!existing) return incoming || null
  if (!incoming) return existing

  const merged = { ...existing, ...incoming }

  const exPb = existing.postedBy
  const inPb = incoming.postedBy
  if (exPb && typeof exPb === 'object' && (exPb.username || exPb.name)) {
    if (inPb && typeof inPb === 'object') merged.postedBy = { ...exPb, ...inPb }
    else if (typeof inPb === 'string') merged.postedBy = { ...exPb, _id: inPb }
    else merged.postedBy = exPb
  }

  if (Array.isArray(incoming.contributors)) {
    const exMap = new Map()
    for (const c of existing.contributors || []) {
      const id = contributorIdStr(c)
      if (id) exMap.set(id, typeof c === 'object' ? c : { _id: c })
    }
    merged.contributors = incoming.contributors.map((c) => {
      const id = contributorIdStr(c)
      const inc = typeof c === 'object' ? c : { _id: c }
      const old = exMap.get(id)
      if (old && !(inc.username || inc.name)) return { ...old, ...inc }
      return inc
    })
  }

  // Socket JSON omits cleared img — trust images / collaboratorImages from the server.
  if (Array.isArray(incoming.images)) merged.images = incoming.images
  if (Array.isArray(incoming.collaboratorImages)) {
    merged.collaboratorImages = incoming.collaboratorImages
  }
  if (incoming.img != null && incoming.img !== '') {
    merged.img = incoming.img
  } else if (Array.isArray(incoming.images)) {
    merged.img = incoming.images.length > 0 ? incoming.images[0] : undefined
  } else if (incoming.img === null || incoming.img === '') {
    merged.img = undefined
  }

  if ('audio' in incoming) merged.audio = incoming.audio
  if ('text' in incoming) merged.text = incoming.text
  if ('editedAt' in incoming) merged.editedAt = incoming.editedAt
  if ('isCollaborative' in incoming) merged.isCollaborative = incoming.isCollaborative

  return merged
}

/** Profile lists authored posts and collaborative posts the user contributes to.
 * Prefer IDs — username is only a fallback when author id is missing.
 */
export function postBelongsToProfile(post, profileUser) {
  if (!post || !profileUser) return false
  const profileId = profileUser._id != null ? String(profileUser._id) : ''
  const profileUsername =
    typeof profileUser.username === 'string' ? profileUser.username.trim() : ''
  if (!profileId && !profileUsername) return false

  const authorId = contributorIdStr(post.postedBy)
  const authorUsername =
    typeof post.postedBy === 'object' && post.postedBy?.username
      ? String(post.postedBy.username).trim()
      : ''

  if (profileId && authorId && authorId === profileId) return true
  if (!authorId && profileUsername && authorUsername && authorUsername === profileUsername) {
    return true
  }

  if (post.isCollaborative === true && Array.isArray(post.contributors)) {
    return post.contributors.some((c) => {
      const cid = contributorIdStr(c)
      if (profileId && cid && cid === profileId) return true
      const uname = typeof c === 'object' && c?.username ? String(c.username).trim() : ''
      return !cid && !!profileUsername && !!uname && uname === profileUsername
    })
  }
  return false
}

function sortPostsNewestFirst(list) {
  return [...list].sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAt).getTime()
    const dateB = new Date(b.updatedAt || b.createdAt).getTime()
    return dateB - dateA
  })
}

export function upsertProfilePost(list, incoming, postId) {
  const idStr = postId?.toString?.()
  if (!idStr) return list
  const idx = list.findIndex((p) => p._id?.toString?.() === idStr)
  if (idx === -1) return sortPostsNewestFirst([incoming, ...list])
  const replaced = mergePostUpdate(list[idx], incoming)
  return sortPostsNewestFirst([replaced, ...list.filter((_, i) => i !== idx)])
}
