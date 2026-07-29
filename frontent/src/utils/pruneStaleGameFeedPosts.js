/**
 * Clear ghost chess / Go Fish feed cards when end/cancel was missed (socket drop).
 * Ask the server who is still in a game; if neither player is busy, drop the card.
 */

import {
  getCardGameDataForPost,
  getChessGameDataForPost,
  getGameRoomIdFromPost,
  isChessFeedPost,
  isGoFishFeedPost,
} from './gameFeedPostUtils.js'

const apiBase = () =>
  import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'

async function fetchBusyUserIds(path) {
  try {
    const res = await fetch(`${apiBase()}${path}`, { credentials: 'include' })
    if (!res.ok) return null
    const data = await res.json().catch(() => ({}))
    return (data?.busyUserIds || [])
      .map((x) => (x != null ? String(x).trim() : ''))
      .filter(Boolean)
  } catch {
    return null
  }
}

function playerIdsFromGameData(data) {
  if (!data) return []
  const out = []
  for (const key of ['player1', 'player2']) {
    const id = data?.[key]?._id != null ? String(data[key]._id).trim() : ''
    if (id) out.push(id)
  }
  return out
}

function isStillShowingLiveGameCard(post) {
  if (isChessFeedPost(post)) {
    const data = getChessGameDataForPost(post)
    return data?.gameStatus === 'active' || data?.gameStatus == null
  }
  if (isGoFishFeedPost(post)) {
    const data = getCardGameDataForPost(post)
    return data?.gameStatus === 'active' || data?.gameStatus == null
  }
  return false
}

/**
 * Drop chess/card "Playing… Live" cards whose players are no longer in any active game.
 * On network failure, returns posts unchanged (don't guess).
 */
export async function pruneStaleGameFeedPosts(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return posts

  const candidates = posts.filter(
    (p) => (isChessFeedPost(p) || isGoFishFeedPost(p)) && isStillShowingLiveGameCard(p),
  )
  if (!candidates.length) return posts

  const needsChess = candidates.some((p) => isChessFeedPost(p))
  const needsCard = candidates.some((p) => isGoFishFeedPost(p))

  const [chessBusy, cardBusy] = await Promise.all([
    needsChess ? fetchBusyUserIds('/api/user/busyChessUsers') : Promise.resolve([]),
    needsCard ? fetchBusyUserIds('/api/user/busyCardUsers') : Promise.resolve([]),
  ])

  if (needsChess && chessBusy == null) return posts
  if (needsCard && cardBusy == null) return posts

  const chessBusySet = new Set(chessBusy || [])
  const cardBusySet = new Set(cardBusy || [])
  const staleRoomIds = new Set()
  const stalePostIds = new Set()

  for (const post of candidates) {
    const roomId = getGameRoomIdFromPost(post)
    const isChess = isChessFeedPost(post)
    const data = isChess ? getChessGameDataForPost(post) : getCardGameDataForPost(post)
    const players = playerIdsFromGameData(data)
    if (!players.length && !roomId) continue

    const busySet = isChess ? chessBusySet : cardBusySet
    const anyoneStillBusy = players.some((id) => busySet.has(id))
    if (anyoneStillBusy) continue

    if (roomId) {
      staleRoomIds.add(roomId)
      try {
        window.dispatchEvent(new CustomEvent('chessGameFeedUiEnded', { detail: { roomId } }))
      } catch (_) { /* ignore */ }
    }
    const pid = post?._id != null ? String(post._id) : ''
    if (pid) stalePostIds.add(pid)
  }

  if (!stalePostIds.size && !staleRoomIds.size) return posts

  return posts.filter((p) => {
    const pid = p?._id != null ? String(p._id) : ''
    if (pid && stalePostIds.has(pid)) return false
    const rid = getGameRoomIdFromPost(p)
    if (rid && staleRoomIds.has(rid)) return false
    return true
  })
}
