/** Chess / Go Fish feed posts — detect, dedupe, stable player slots. */

export const GO_FISH_TEXT_RE = /Playing Go Fish with/i
export const CHESS_TEXT_RE = /Playing chess with/i

export function parseGameDataRaw(raw) {
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

/** @deprecated use parseGameDataRaw */
export const parseCardGameDataRaw = parseGameDataRaw

export function isChessFeedPost(post) {
  if (post?.chessGameData) return true
  return CHESS_TEXT_RE.test(post?.text || '')
}

export function isGoFishFeedPost(post) {
  if (post?.cardGameData) return true
  return GO_FISH_TEXT_RE.test(post?.text || '')
}

export function getGameRoomIdFromPost(post) {
  const raw = post?.chessGameData ?? post?.cardGameData
  if (!raw) return ''
  const data = parseGameDataRaw(raw)
  return data?.roomId != null ? String(data.roomId).trim() : ''
}

export function getGoFishPairDedupeKey(post) {
  if (!isGoFishFeedPost(post)) return ''
  const roomId = getGameRoomIdFromPost(post)
  if (roomId) return `room:${roomId}`
  const authorName = (post?.postedBy?.name || post?.postedBy?.username || '')
    .trim()
    .toLowerCase()
  const m = String(post?.text || '').match(/Playing Go Fish with\s+(.+?)\s*🃏/i)
  const opponentName = (m?.[1] || '').trim().toLowerCase()
  if (!authorName || !opponentName) return ''
  return `gofish:${[authorName, opponentName].sort().join('|')}`
}

export function getChessPairDedupeKey(post) {
  if (!isChessFeedPost(post)) return ''
  const roomId = getGameRoomIdFromPost(post)
  if (roomId) return `room:${roomId}`
  const authorName = (post?.postedBy?.name || post?.postedBy?.username || '')
    .trim()
    .toLowerCase()
  const m = String(post?.text || '').match(/Playing chess with\s+(.+?)\s*♟️/i)
  const opponentName = (m?.[1] || '').trim().toLowerCase()
  if (!authorName || !opponentName) return ''
  return `chess:${[authorName, opponentName].sort().join('|')}`
}

export function getGameFeedDedupeKey(post) {
  const roomId = getGameRoomIdFromPost(post)
  if (roomId) return `room:${roomId}`
  return getGoFishPairDedupeKey(post) || getChessPairDedupeKey(post)
}

/** Same game card always shows players in the same slots (sorted by user id). */
export function normalizeGamePlayers(data) {
  if (!data) return null
  const p1 = data.player1
  const p2 = data.player2
  const id1 = p1?._id != null ? String(p1._id) : ''
  const id2 = p2?._id != null ? String(p2._id) : ''
  if (id1 && id2 && id1 > id2) {
    return { ...data, player1: p2, player2: p1 }
  }
  return data
}

/** @deprecated use normalizeGamePlayers */
export const normalizeCardGamePlayers = normalizeGamePlayers

export function pickPreferredGameFeedPost(kept, candidate) {
  const keptHas = !!(kept?.chessGameData || kept?.cardGameData)
  const candHas = !!(candidate?.chessGameData || candidate?.cardGameData)
  if (candHas && !keptHas) return candidate
  if (keptHas && !candHas) return kept
  const keptId = kept?.postedBy?._id?.toString?.() ?? String(kept?.postedBy?._id ?? '')
  const candId = candidate?.postedBy?._id?.toString?.() ?? String(candidate?.postedBy?._id ?? '')
  if (candId && keptId && candId < keptId) return candidate
  return kept
}

/** @deprecated use pickPreferredGameFeedPost */
export const pickPreferredGoFishFeedPost = pickPreferredGameFeedPost

export function mergeGameFeedPostData(kept, incoming) {
  const preferred = pickPreferredGameFeedPost(kept, incoming)
  const other = preferred === kept ? incoming : kept
  const merged = { ...preferred }
  if (!merged.chessGameData && other?.chessGameData) {
    merged.chessGameData = other.chessGameData
  }
  if (!merged.cardGameData && other?.cardGameData) {
    merged.cardGameData = other.cardGameData
  }
  return merged
}

/** @deprecated use mergeGameFeedPostData */
export const mergeGoFishFeedPostData = mergeGameFeedPostData

export function getChessGameDataForPost(post) {
  const parsed = parseGameDataRaw(post?.chessGameData)
  if (parsed) return normalizeGamePlayers(parsed)
  if (!isChessFeedPost(post)) return null
  const m = String(post?.text || '').match(/Playing chess with\s+(.+?)\s*♟️/i)
  const opponentName = m?.[1]?.trim()
  const pb = post?.postedBy
  return normalizeGamePlayers({
    player1: {
      _id: pb?._id?.toString?.() ?? String(pb?._id ?? ''),
      username: pb?.username,
      name: pb?.name,
      profilePic: pb?.profilePic,
    },
    player2: { name: opponentName || 'Opponent' },
    gameStatus: 'active',
  })
}

export function getCardGameDataForPost(post) {
  const parsed = parseGameDataRaw(post?.cardGameData)
  if (parsed) return normalizeGamePlayers(parsed)
  if (!isGoFishFeedPost(post)) return null
  const m = String(post?.text || '').match(/Playing Go Fish with\s+(.+?)\s*🃏/i)
  const opponentName = m?.[1]?.trim()
  const pb = post?.postedBy
  return normalizeGamePlayers({
    player1: {
      _id: pb?._id?.toString?.() ?? String(pb?._id ?? ''),
      username: pb?.username,
      name: pb?.name,
      profilePic: pb?.profilePic,
    },
    player2: { name: opponentName || 'Opponent' },
    gameStatus: 'active',
    gameType: 'goFish',
  })
}

export function buildMinimalCardGameDataFromText(post) {
  return getCardGameDataForPost(post)
}
