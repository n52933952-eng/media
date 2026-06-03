/**
 * One feed card per chess/card game (same roomId) when viewer follows both players.
 */

export function getGameRoomIdFromPost(post) {
  const raw = post?.chessGameData ?? post?.cardGameData
  if (!raw) return ''
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    return data?.roomId != null ? String(data.roomId).trim() : ''
  } catch {
    return ''
  }
}

export function dedupeGamePostsForFeed(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return posts
  const seenRoomIds = new Set()
  const out = []
  for (const post of posts) {
    const roomId = getGameRoomIdFromPost(post)
    if (!roomId) {
      out.push(post)
      continue
    }
    if (seenRoomIds.has(roomId)) continue
    seenRoomIds.add(roomId)
    out.push(post)
  }
  return out
}
