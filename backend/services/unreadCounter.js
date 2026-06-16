import mongoose from 'mongoose'
import Message from '../models/message.js'
import { getRedis } from './redis.js'

const totalKey = (userId) => `unread:total:${String(userId)}`
const convKey = (userId, conversationId) =>
  `unread:conv:${String(userId)}:${String(conversationId)}`

const parseCount = (val) => {
  const n = Number(val)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** Rebuild total + per-conversation unread from Mongo (single aggregation). */
export async function rebuildUnreadCache(userId) {
  const uid = String(userId)
  const userOid = mongoose.Types.ObjectId.isValid(uid)
    ? new mongoose.Types.ObjectId(uid)
    : userId

  const rows = await Message.aggregate([
    {
      $lookup: {
        from: 'conversations',
        localField: 'conversationId',
        foreignField: '_id',
        as: 'conv',
      },
    },
    { $unwind: '$conv' },
    {
      $match: {
        seen: false,
        sender: { $ne: userOid },
        'conv.participants': userOid,
      },
    },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ])

  const client = getRedis()
  const pipe = client.multi()
  const oldConvKeys = await client.keys(convKey(uid, '*'))
  if (oldConvKeys.length) pipe.del(oldConvKeys)
  pipe.del(totalKey(uid))

  let total = 0
  for (const row of rows) {
    const cid = String(row._id)
    const count = row.count || 0
    if (count > 0) {
      total += count
      pipe.set(convKey(uid, cid), String(count))
    }
  }
  pipe.set(totalKey(uid), String(total))
  await pipe.exec()
  return total
}

export async function getTotalUnread(userId, { rebuildOnMiss = true } = {}) {
  const uid = String(userId)
  try {
    const client = getRedis()
    const cached = await client.get(totalKey(uid))
    if (cached != null) return parseCount(cached)
    if (!rebuildOnMiss) return 0
    return rebuildUnreadCache(uid)
  } catch {
    return countTotalUnreadFromDb(uid)
  }
}

async function countTotalUnreadFromDb(userId) {
  const userOid = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId
  const result = await Message.aggregate([
    {
      $lookup: {
        from: 'conversations',
        localField: 'conversationId',
        foreignField: '_id',
        as: 'conv',
      },
    },
    {
      $match: {
        seen: false,
        sender: { $ne: userOid },
        'conv.participants': userOid,
      },
    },
    { $count: 'totalUnread' },
  ])
  return result[0]?.totalUnread ?? 0
}

/** +1 unread for one conversation (message received). */
export async function incrementUnread(userId, conversationId, by = 1) {
  const uid = String(userId)
  const cid = String(conversationId)
  const delta = Math.max(1, Math.floor(by))
  try {
    const client = getRedis()
    const exists = await client.exists(totalKey(uid))
    if (!exists) await rebuildUnreadCache(uid)
    const pipe = client.multi()
    pipe.incrBy(convKey(uid, cid), delta)
    pipe.incrBy(totalKey(uid), delta)
    await pipe.exec()
    return getTotalUnread(uid, { rebuildOnMiss: false })
  } catch {
    return countTotalUnreadFromDb(uid)
  }
}

/** Clear unread for one conversation (mark as read). */
export async function clearConversationUnread(userId, conversationId) {
  const uid = String(userId)
  const cid = String(conversationId)
  try {
    const client = getRedis()
    const convUnread = parseCount(await client.get(convKey(uid, cid)))
    const pipe = client.multi()
    pipe.del(convKey(uid, cid))
    if (convUnread > 0) pipe.decrBy(totalKey(uid, convUnread))
    await pipe.exec()
    const total = parseCount(await client.get(totalKey(uid)))
    if (total < 0) {
      await client.set(totalKey(uid), '0')
      return 0
    }
    return total
  } catch {
    return countTotalUnreadFromDb(uid)
  }
}

/** Remove conversation unread keys for both users (DM deleted). */
export async function clearConversationUnreadForUsers(userIds, conversationId) {
  await Promise.all(
    (userIds || []).map((uid) => clearConversationUnread(uid, conversationId)),
  )
}

export async function emitUnreadCountUpdate(io, userId, getUserSocketFn) {
  if (!io || !userId) return
  const total = await getTotalUnread(userId)
  const uid = String(userId)
  const { getUserSelfRoomId } = await import('../socket/socket.js')
  const selfRoom = getUserSelfRoomId(uid)
  if (selfRoom) {
    io.to(selfRoom).emit('unreadCountUpdate', { totalUnread: total })
    return
  }
  const sock = await getUserSocketFn(uid)
  if (sock?.socketId) {
    io.to(sock.socketId).emit('unreadCountUpdate', { totalUnread: total })
  }
}
