import mongoose from 'mongoose'
import Post from '../models/post.js'

/** Find chess/card posts by indexed gameRoomId, with JSON fallback for legacy rows. */
export async function findPostsByGameRoomId(roomId) {
  if (!roomId) return []

  const indexed = await Post.find({ gameRoomId: roomId }).lean()
  if (indexed.length > 0) return indexed

  const isChess = String(roomId).startsWith('chess_')
  const isCard = String(roomId).startsWith('card_')
  if (!isChess && !isCard) return []

  const field = isChess ? 'chessGameData' : 'cardGameData'
  const candidates = await Post.find({
    [field]: { $exists: true, $ne: null },
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  })
    .select('_id postedBy text chessGameData cardGameData createdAt updatedAt')
    .limit(200)
    .lean()

  const matches = []
  for (const post of candidates) {
    try {
      const raw = post[field]
      if (!raw) continue
      const data = JSON.parse(raw)
      if (data?.roomId === roomId) {
        matches.push(post)
        Post.updateOne({ _id: post._id }, { $set: { gameRoomId: roomId } }).catch(() => {})
      }
    } catch {
      /* ignore */
    }
  }
  return matches
}

export async function backfillGameRoomId(postId, roomId) {
  if (!postId || !roomId) return
  if (!mongoose.isValidObjectId(String(postId))) return
  await Post.updateOne({ _id: postId, gameRoomId: { $in: [null, ''] } }, { $set: { gameRoomId: roomId } }).catch(
    () => {},
  )
}
