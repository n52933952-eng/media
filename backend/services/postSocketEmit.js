import { getUserSocket } from '../socket/socket.js'

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

export async function emitToUserIds(io, userIds, event, payload) {
  if (!io || !userIds?.length) return 0
  const socketIds = await collectSocketIdsForUserIds(userIds)
  for (const socketId of socketIds) {
    io.to(socketId).emit(event, payload)
  }
  return socketIds.size
}
