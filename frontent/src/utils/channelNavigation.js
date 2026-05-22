import API_BASE_URL from '../config/api'

/**
 * Ensure a channel live-stream post exists for this viewer (same as desktop "Watch Live"),
 * then return postId + username for navigation.
 */
export async function ensureChannelLivePost(channel, streamIndex = 0) {
  if (!channel?.id) {
    return { ok: false, error: 'Invalid channel' }
  }

  const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
  const res = await fetch(
    `${baseUrl}/api/news/post/livestream?channelId=${encodeURIComponent(channel.id)}&streamIndex=${streamIndex}`,
    { method: 'POST', credentials: 'include' }
  )
  const data = await res.json().catch(() => ({}))

  if (data?.postId && channel.username) {
    return {
      ok: true,
      postId: data.postId,
      username: channel.username,
      posted: !!data.posted,
    }
  }

  return {
    ok: false,
    error: data?.error || data?.message || 'Could not open channel',
    status: res.status,
  }
}

/** Fallback: latest post from channel system account (after livestream API ran once). */
export async function fetchLatestChannelPostId(channelUsername) {
  const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
  const userRes = await fetch(`${baseUrl}/api/user/getUserPro/${encodeURIComponent(channelUsername)}`, {
    credentials: 'include',
  })
  const userData = await userRes.json()
  if (!userRes.ok || userData?.error || !userData?._id) {
    return null
  }
  const postsRes = await fetch(`${baseUrl}/api/post/user/id/${userData._id}?limit=1`, {
    credentials: 'include',
  })
  const postsData = await postsRes.json()
  if (postsRes.ok && postsData.posts?.length > 0) {
    return postsData.posts[0]._id
  }
  return null
}

/** Scroll mobile home feed into view; optionally center a specific post card. */
export function scrollToHomeFeed(postId) {
  const run = () => {
    if (postId) {
      const postEl = document.querySelector(`[data-post-id="${postId}"]`)
      if (postEl) {
        postEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }
    document.getElementById('home-feed-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  requestAnimationFrame(() => {
    setTimeout(run, 500)
    setTimeout(run, 1200)
  })
}
