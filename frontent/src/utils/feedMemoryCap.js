/** Max posts kept in memory while scrolling — prevents DOM/RAM from growing forever. */
export const FEED_IN_MEMORY_MAX_POSTS = 300

/**
 * Newest-first feed: keep live cards pinned, drop oldest normal posts at the bottom.
 * Matches mobile `PostContext.trimFeedPostsToMax`.
 */
export function trimFeedPostsToMax(list) {
  const safe = Array.isArray(list) ? list : []
  if (safe.length <= FEED_IN_MEMORY_MAX_POSTS) return safe

  const live = safe.filter((p) => p?.isLive)
  const normal = safe.filter((p) => !p?.isLive)
  const maxNormal = FEED_IN_MEMORY_MAX_POSTS - live.length
  if (maxNormal <= 0) return live.slice(0, FEED_IN_MEMORY_MAX_POSTS)
  return [...live, ...normal.slice(0, maxNormal)]
}
