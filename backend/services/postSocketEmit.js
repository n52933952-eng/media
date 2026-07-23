import { getUserSocket } from '../socket/socket.js'

export const POST_ROOM_PREFIX = 'post:'

/** Emit engagement updates only to clients subscribed to this post room (lightweight). */
export function emitPostEngagement(io, postId, payload) {
  if (!io || !postId) return
  const room = `${POST_ROOM_PREFIX}${String(postId)}`
  io.to(room).emit('postEngagement', {
    postId: String(postId),
    ...payload,
  })
}

/** Per-user Redis lookup — scales with follower count, not total online users. */
export async function collectSocketIdsForUserIds(userIds) {
  const unique = [...new Set(
    (userIds || [])
      .map((id) => id?.toString?.() ?? (id != null ? String(id) : ''))
      .filter(Boolean),
  )]

  const socketIds = new Set()
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const sock = await getUserSocket(uid)
        if (sock?.socketId) socketIds.add(sock.socketId)
      } catch {
        /* ignore */
      }
    }),
  )
  return socketIds
}

/** Emit to every connected tab/device for each user via `userSelf:<id>` rooms (not a single Redis socket id). */
export async function emitToUserIds(io, userIds, event, payload) {
  if (!io || !userIds?.length) return 0
  const unique = [
    ...new Set(
      (userIds || [])
        .map((id) => id?.toString?.() ?? (id != null ? String(id) : ''))
        .filter(Boolean),
    ),
  ]
  for (const uid of unique) {
    io.to(`userSelf:${uid}`).emit(event, payload)
  }
  return unique.length
}
