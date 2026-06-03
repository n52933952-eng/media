import User from '../models/user.js'
import * as redisService from '../services/redis.js'
import {
  isGoFishFeedPost,
  parseCardGameDataRaw,
  normalizeGamePlayers,
} from './gameFeedPostUtils.js'

/** Attach cardGameData from Redis for legacy Go Fish posts that only have text. */
export async function enrichGoFishPostsForFeed(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return posts

  const needsEnrich = posts.filter((p) => isGoFishFeedPost(p) && !p.cardGameData)
  if (needsEnrich.length === 0) return posts

  const authorIds = [
    ...new Set(
      needsEnrich
        .map((p) => p.postedBy?._id?.toString?.() ?? String(p.postedBy?._id ?? ''))
        .filter(Boolean),
    ),
  ]

  const roomByAuthor = new Map()
  for (const aid of authorIds) {
    try {
      const roomId = await redisService.redisGet(`activeCardGame:${aid}`)
      if (roomId) roomByAuthor.set(aid, String(roomId))
    } catch {
      /* redis optional during enrich */
    }
  }

  if (roomByAuthor.size === 0) return posts

  const userIds = new Set()
  for (const roomId of roomByAuthor.values()) {
    const parts = String(roomId).split('_')
    if (parts[0] === 'card' && parts.length >= 4) {
      userIds.add(parts[1])
      userIds.add(parts[2])
    }
  }

  let userMap = new Map()
  if (userIds.size > 0) {
    const users = await User.find({ _id: { $in: [...userIds] } })
      .select('username name profilePic')
      .lean()
    userMap = new Map(users.map((u) => [u._id.toString(), u]))
  }

  for (const post of posts) {
    if (post.cardGameData) continue
    if (!isGoFishFeedPost(post)) continue
    const aid = post.postedBy?._id?.toString?.() ?? String(post.postedBy?._id ?? '')
    const roomId = aid ? roomByAuthor.get(aid) : null
    if (!roomId) continue
    const parts = String(roomId).split('_')
    if (parts[0] !== 'card' || parts.length < 4) continue
    const p1id = parts[1]
    const p2id = parts[2]
    const u1 = userMap.get(p1id)
    const u2 = userMap.get(p2id)
    let gameStatus = 'active'
    try {
      const stateRaw = await redisService.redisGet(`cardGameState:${roomId}`)
      const state = parseCardGameDataRaw(stateRaw)
      if (state?.gameStatus) gameStatus = state.gameStatus
    } catch {
      /* ignore */
    }
    post.cardGameData = JSON.stringify(
      normalizeGamePlayers({
        roomId,
        player1: {
          _id: p1id,
          username: u1?.username,
          name: u1?.name,
          profilePic: u1?.profilePic,
        },
        player2: {
          _id: p2id,
          username: u2?.username,
          name: u2?.name,
          profilePic: u2?.profilePic,
        },
        gameStatus,
        gameType: 'goFish',
      }),
    )
  }

  return posts
}
