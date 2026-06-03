/**
 * One feed card per active chess/card game (same roomId), even when both players have a post.
 * Go Fish text-only posts dedupe by sorted player display names when roomId is absent.
 */

import { getGameFeedDedupeKey, mergeGoFishFeedPostData } from './gameFeedPostUtils.js'

export { getGameRoomIdFromPost } from './gameFeedPostUtils.js'

export function dedupeGamePostsForFeed(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return posts
  const keyToIndex = new Map()
  const out = []
  for (const post of posts) {
    const key = getGameFeedDedupeKey(post)
    if (!key) {
      out.push(post)
      continue
    }
    const idx = keyToIndex.get(key)
    if (idx === undefined) {
      keyToIndex.set(key, out.length)
      out.push(post)
      continue
    }
    out[idx] = mergeGoFishFeedPostData(out[idx], post)
  }
  return out
}
