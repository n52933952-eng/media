import Conversation from '../models/conversation.js'
import Message from '../models/message.js'
import { getRecipientSockedId, getIO, getUserSocket, isUserEffectivelyOnline, getUserSelfRoomId } from '../socket/socket.js'
import { deleteMediaAsset, isManagedMediaUrl } from '../services/mediaStorage.js'
import { assertManagedMediaUrls } from '../services/r2Presign.js'
import { incrementUnread, clearConversationUnreadForUsers, emitUnreadCountUpdate, getTotalUnread } from '../services/unreadCounter.js'
import mongoose from 'mongoose'
import {
  encodeConversationCursor,
  decodeConversationCursor,
  CONVERSATIONS_PAGE_SIZE_DEFAULT,
} from '../services/conversationCursor.js'
import {
  encodeMessageCursor,
  decodeMessageCursor,
  MESSAGES_PAGE_SIZE_DEFAULT,
} from '../services/messageCursor.js'
import { buildConversationLastMessageFromMessage } from '../services/conversationLastMessage.js'

// ── helpers ────────────────────────────────────────────────────────────────
const idStr = (id) => (id != null ? id.toString() : '')

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Shared lookups after participants are populated on each conversation row. */
function buildConversationListEnrichmentStages(userId) {
  const userOid = new mongoose.Types.ObjectId(userId)
  return [
    {
      $addFields: {
        participants: {
          $cond: {
            if: { $eq: ['$isGroup', true] },
            then: '$participants',
            else: {
              $filter: {
                input: '$participants',
                as: 'p',
                cond: { $ne: ['$$p._id', userOid] },
              },
            },
          },
        },
        __denormLastMessageReady: {
          $and: [
            { $ne: [{ $ifNull: ['$lastMessage.sender', null] }, null] },
            { $ne: [{ $ifNull: ['$lastMessage.createdAt', null] }, null] },
            { $ne: [{ $ifNull: ['$lastMessage.messageId', null] }, null] },
          ],
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'lastMessage.sender',
        foreignField: '_id',
        as: '__denormSender',
        pipeline: [{ $project: { username: 1, name: 1, profilePic: 1 } }],
      },
    },
    {
      $lookup: {
        from: 'messages',
        let: { convId: '$_id', useLookup: '$__denormLastMessageReady' },
        as: '__lastMessageDoc',
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$conversationId', '$$convId'] },
                  { $eq: ['$$useLookup', false] },
                ],
              },
            },
          },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          {
            $lookup: {
              from: 'users',
              localField: 'sender',
              foreignField: '_id',
              as: 'sender',
              pipeline: [{ $project: { username: 1, name: 1, profilePic: 1 } }],
            },
          },
          { $addFields: { sender: { $arrayElemAt: ['$sender', 0] } } },
          { $project: { text: 1, sender: 1, createdAt: 1, delivered: 1, seen: 1 } },
        ],
      },
    },
    {
      $lookup: {
        from: 'messages',
        let: { convId: '$_id' },
        as: '__tickSource',
        pipeline: [
          { $match: { $expr: { $eq: ['$conversationId', '$$convId'] } } },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          { $project: { seen: 1, delivered: 1, _id: 1 } },
        ],
      },
    },
    {
      $addFields: {
        lastMessage: {
          $cond: {
            if: '$__denormLastMessageReady',
            then: {
              text: { $ifNull: ['$lastMessage.text', ''] },
              sender: { $arrayElemAt: ['$__denormSender', 0] },
              createdAt: '$lastMessage.createdAt',
              messageId: {
                $ifNull: [
                  '$lastMessage.messageId',
                  { $arrayElemAt: ['$__tickSource._id', 0] },
                ],
              },
              delivered: {
                $cond: {
                  if: { $gt: [{ $size: { $ifNull: ['$__tickSource', []] } }, 0] },
                  then: { $eq: [{ $arrayElemAt: ['$__tickSource.delivered', 0] }, true] },
                  else: false,
                },
              },
              seen: {
                $cond: {
                  if: { $gt: [{ $size: { $ifNull: ['$__tickSource', []] } }, 0] },
                  then: { $eq: [{ $arrayElemAt: ['$__tickSource.seen', 0] }, true] },
                  else: false,
                },
              },
            },
            else: { $arrayElemAt: ['$__lastMessageDoc', 0] },
          },
        },
      },
    },
    {
      $lookup: {
        from: 'messages',
        let: { convId: '$_id' },
        as: '__unread',
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$conversationId', '$$convId'] },
                  { $eq: ['$seen', false] },
                  { $ne: ['$sender', userOid] },
                ],
              },
            },
          },
          { $count: 'count' },
        ],
      },
    },
    {
      $addFields: {
        unreadCount: {
          $ifNull: [{ $arrayElemAt: ['$__unread.count', 0] }, 0],
        },
      },
    },
    { $project: { __lastMessageDoc: 0, __unread: 0, __denormSender: 0, __denormLastMessageReady: 0, __tickSource: 0 } },
  ]
}

const notifySenderMessageDelivered = (senderStr, messageId, conversationId) => {
  try {
    const io = getIO()
    const room = getUserSelfRoomId(senderStr)
    if (!io || !room) return
    io.to(room).emit('messageDelivered', {
      messageId: String(messageId),
      conversationId: String(conversationId),
    })
  } catch {
    // best-effort
  }
}

async function destroyMediaAssetForMessageImgUrl(imgUrl) {
  if (!imgUrl) return
  await deleteMediaAsset(imgUrl)
}

async function destroyMediaAssetsForConversation(conversationId) {
  const msgs = await Message.find({ conversationId }).select('img').lean()
  const urls = [
    ...new Set(
      msgs
        .map((m) => (m?.img && String(m.img).trim()) || '')
        .filter((u) => isManagedMediaUrl(u))
    ),
  ]
  if (!urls.length) return
  await Promise.all(urls.map((u) => destroyMediaAssetForMessageImgUrl(u)))
  console.log(`🧹 [message] storage cleanup for conversation ${idStr(conversationId)}: ${urls.length} unique asset(s)`)
}

/** Delete 1:1 DM + all messages for both participants (e.g. on unfollow). Returns conversation id or null. */
export async function deleteDirectConversationBetweenUsers(userIdA, userIdB) {
  const aStr = idStr(userIdA)
  const bStr = idStr(userIdB)
  if (!aStr || !bStr || aStr === bStr) return null

  const aOid = mongoose.Types.ObjectId.isValid(aStr) ? new mongoose.Types.ObjectId(aStr) : userIdA
  const bOid = mongoose.Types.ObjectId.isValid(bStr) ? new mongoose.Types.ObjectId(bStr) : userIdB

  const conversation = await Conversation.findOne({
    isGroup: { $ne: true },
    participants: { $all: [aOid, bOid] },
  })

  if (!conversation || conversation.isGroup || conversation.participants?.length !== 2) {
    return null
  }

  const convIdStr = idStr(conversation._id)

  const io = getIO()
  if (io) {
    io.to(convIdStr).emit('conversationDeleted', { conversationId: convIdStr })
    for (const uid of [aStr, bStr]) {
      const selfRoom = getUserSelfRoomId(uid)
      if (selfRoom) {
        io.to(selfRoom).emit('conversationDeleted', { conversationId: convIdStr })
      }
    }
  }

  await destroyMediaAssetsForConversation(conversation._id)
  await Message.deleteMany({ conversationId: conversation._id })
  await Conversation.findByIdAndDelete(conversation._id)
  await clearConversationUnreadForUsers([aStr, bStr], convIdStr)

  console.log(`🗑️ [message] Deleted DM ${convIdStr} between ${aStr} and ${bStr}`)
  return convIdStr
}

/**
 * Broadcast to a Socket.IO conversation room (all online members) and send
 * FCM push to participants who are NOT currently in the room (offline).
 */
async function broadcastToConversation(conversationId, event, payload, excludeSenderId, participantIds, senderPopulated, groupName) {
  const io = getIO()
  const roomId = idStr(conversationId)
  if (io) {
    io.to(roomId).emit(event, payload)
    // Also fan-out to each member's self room so they receive group events even if
    // they haven't joined the conversation room yet (lighter socket connect).
    if (event === 'newMessage') {
      const { getUserSelfRoomId } = await import('../socket/socket.js')
      const room = io?.sockets?.adapter?.rooms?.get(roomId)
      const onlineSids = room ? [...room] : []
      for (const pid of participantIds) {
        const pidStr = idStr(pid)
        if (!pidStr || pidStr === idStr(excludeSenderId)) continue
        const recipSocket = await getUserSocket(pidStr)
        const inRoom = recipSocket?.socketId && onlineSids.includes(recipSocket.socketId)
        if (!inRoom) {
          const selfRoom = getUserSelfRoomId(pidStr)
          if (selfRoom) io.to(selfRoom).emit(event, payload)
        }
      }
    }
  }

  // Push to offline members (those not in the socket room)
  try {
    const room = io?.sockets?.adapter?.rooms?.get(roomId)
    const onlineSids = room ? [...room] : []
    const { sendGroupMessageNotification, sendMessageNotification } = await import('../services/pushNotifications.js')

    for (const pid of participantIds) {
      const pidStr = idStr(pid)
      if (pidStr === idStr(excludeSenderId)) continue
      // Check if this participant has a socket in the room
      const recipSocket = await getUserSocket(pidStr)
      const inRoom = recipSocket?.socketId && onlineSids.includes(recipSocket.socketId)
      if (!inRoom) {
        if (groupName) {
          const sName = senderPopulated?.name || senderPopulated?.username || 'Someone'
          sendGroupMessageNotification([pidStr], sName, groupName, roomId, payload._id || '').catch(() => {})
        } else {
          sendMessageNotification(pidStr, senderPopulated, roomId, payload._id || '').catch(() => {})
        }
      }
    }
  } catch (e) {
    console.error('broadcastToConversation push error:', e?.message)
  }
}

/**
 * Fan-out to recipient: socket only if connected **and** presence is not `offline` (foreground).
 * If the app is backgrounded it emits `clientPresence: offline` while the WebSocket can stay open
 * for a while on some devices — without this check we'd skip FCM and the user gets no push.
 * `delivered` stays false until the recipient app emits `ackMessageDelivered` (WhatsApp-style).
 */
async function deliverOutboundMessage(newMessage, conversation, recipientId) {
  const recipientSocketId = await getRecipientSockedId(recipientId)
  const io = getIO()

  // Important: only deliver via socket if connected AND client is effectively in-app (same idea as calls).
  // Redis may still have stale socketId during disconnect/network flaps.
  if (recipientSocketId && recipientId && io) {
    const recipientSocket = io?.sockets?.sockets?.get?.(recipientSocketId)
    const socketConnected = !!recipientSocket?.connected

    if (socketConnected) {
      const effectivelyOnline = await isUserEffectivelyOnline(recipientId)
      if (effectivelyOnline) {
        const messageWithTimestamp = {
          ...newMessage.toObject(),
          conversationUpdatedAt: conversation.updatedAt,
          delivered: false,
        }
        io.to(recipientSocketId).emit('newMessage', messageWithTimestamp)
        try {
          await incrementUnread(recipientId, conversation._id)
          await emitUnreadCountUpdate(io, recipientId, getUserSocket)
        } catch (error) {
          console.log('Error updating unread count:', error)
        }
        return false
      }
      // Socket still open in background but presence is offline — fall through to FCM
    }
    // Socket exists but isn't connected -> fall through to FCM
  }

  if (recipientId) {
    try {
      const { sendMessageNotification } = await import('../services/pushNotifications.js')
      await sendMessageNotification(recipientId, newMessage.sender, conversation._id.toString(), newMessage._id)
    } catch (e) {
      console.log('❌ Error sending FCM message notification:', e?.message || e)
    }
  }

  return false
}

// Recipient (device) confirms message reached their app.
// This HTTP version is used when app is in background/killed (no socket available yet).
export async function ackMessageDeliveredHttp(req, res) {
  try {
    const body = req?.body || {}
    const recipientUserIdRaw = body?.recipientUserId
    const messageIdsRaw = Array.isArray(body?.messageIds) ? body.messageIds : body?.messageId ? [body.messageId] : []

    const recipientUserId = recipientUserIdRaw != null ? String(recipientUserIdRaw) : ''
    if (!recipientUserId || !Array.isArray(messageIdsRaw) || messageIdsRaw.length === 0) {
      return res.status(400).json({ ok: false, error: 'Missing recipientUserId/messageId' })
    }

    const uniqueIds = [...new Set(messageIdsRaw.map((id) => String(id).trim()).filter(Boolean))].slice(0, 50)
    const objectIds = []
    for (const id of uniqueIds) {
      if (!mongoose.isValidObjectId(id)) continue
      objectIds.push(new mongoose.Types.ObjectId(id))
    }
    if (!objectIds.length) return res.status(400).json({ ok: false, error: 'No valid messageId' })

    // Only mark messages not yet delivered.
    const msgs = await Message.find({
      _id: { $in: objectIds },
      delivered: { $ne: true },
    }).lean()

    const convCache = new Map()
    for (const msg of msgs) {
      const senderStr = msg?.sender != null ? String(msg.sender) : ''
      const ackerId = recipientUserId
      if (!senderStr || senderStr === ackerId) continue

      const convId = msg?.conversationId != null ? String(msg.conversationId) : ''
      if (!convId) continue

      let partStrs = convCache.get(convId)
      if (!partStrs) {
        const conv = await Conversation.findById(convId).select('participants').lean()
        if (!conv?.participants?.length) continue
        partStrs = conv.participants.map((p) => String(p))
        convCache.set(convId, partStrs)
      }
      if (!partStrs.includes(ackerId)) continue

      await Message.updateOne({ _id: msg._id }, { $set: { delivered: true } })
      await Conversation.updateOne(
        { _id: convId, 'lastMessage.messageId': msg._id },
        { $set: { 'lastMessage.delivered': true } },
      )

      notifySenderMessageDelivered(senderStr, msg._id.toString(), convId)
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.warn('ackMessageDeliveredHttp error:', e?.message || e)
    return res.status(500).json({ ok: false, error: 'server_error' })
  }
}

/** Incoming messages not yet delivery-acked — client acks on reconnect so sender gets ✓✓. */
export async function getUndeliveredIncomingMessageIds(req, res) {
  try {
    const userId = req.user?._id
    if (!userId) return res.status(401).json({ messageIds: [] })

    const convs = await Conversation.find({ participants: userId }).select('_id').lean()
    const convIds = convs.map((c) => c._id).filter(Boolean)
    if (!convIds.length) return res.status(200).json({ messageIds: [] })

    const msgs = await Message.find({
      conversationId: { $in: convIds },
      sender: { $ne: userId },
      delivered: { $ne: true },
    })
      .select('_id')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()

    return res.status(200).json({
      messageIds: msgs.map((m) => m._id.toString()),
    })
  } catch (e) {
    console.warn('getUndeliveredIncomingMessageIds error:', e?.message || e)
    return res.status(500).json({ messageIds: [] })
  }
}

function parseLiveShareStreamerId(text) {
  const raw = String(text || '')
  if (!raw.startsWith('LIVE_SHARE:')) return null
  try {
    const data = JSON.parse(raw.slice('LIVE_SHARE:'.length))
    const sid = data?.streamerId != null ? String(data.streamerId).trim() : ''
    return sid || null
  } catch {
    return null
  }
}

/** Core send logic for new messages (JSON body with optional image URL). */
async function _persistAndBroadcastMessage({ conversation, senderId, message, img, replyTo }) {
  const liveShareStreamerId = parseLiveShareStreamerId(message)
  const previewText = (message && String(message).trim()) || (img ? '📷 Image' : '')
  const newMessage = new Message({
    conversationId: conversation._id,
    sender: senderId,
    text: message,
    img: img || '',
    replyTo: replyTo || null,
    ...(liveShareStreamerId ? { liveShareStreamerId } : {}),
  })

  await newMessage.save()

  conversation.lastMessage = buildConversationLastMessageFromMessage({
    ...newMessage.toObject(),
    text: previewText,
  })
  conversation.updatedAt = new Date()
  await conversation.save()

  await newMessage.populate('sender', 'username profilePic name')
  if (newMessage.replyTo) {
    await newMessage.populate({
      path: 'replyTo',
      select: 'text sender',
      populate: { path: 'sender', select: 'username name profilePic' },
    })
  }

  if (conversation.isGroup) {
    // Group: broadcast to Socket.IO room + push to offline members
    const msgObj = { ...newMessage.toObject(), conversationUpdatedAt: conversation.updatedAt, isGroup: true }
    await broadcastToConversation(
      conversation._id,
      'newMessage',
      msgObj,
      senderId,
      conversation.participants,
      newMessage.sender,
      conversation.groupName
    )
    const io = getIO()
    if (io) {
      for (const pid of conversation.participants) {
        const pidStr = idStr(pid)
        if (!pidStr || pidStr === idStr(senderId)) continue
        try {
          await incrementUnread(pidStr, conversation._id)
          await emitUnreadCountUpdate(io, pidStr, getUserSocket)
        } catch (_) {}
      }
    }
    return { responseData: { ...msgObj, delivered: false }, delivered: false }
  } else {
    // 1-to-1: existing delivery path
    const recipientId = conversation.participants.find(p => idStr(p) !== idStr(senderId))
    const delivered = await deliverOutboundMessage(newMessage, conversation, recipientId)
    const responseData = { ...newMessage.toObject(), conversationUpdatedAt: conversation.updatedAt, delivered }
    return { responseData, delivered }
  }
}

export const sendMessaeg = async(req,res) => {
  try {
    const { recipientId, message, replyTo, conversationId: groupConvId } = req.body
    const senderId = req.user._id
    let img = ''

    const imgRaw = req.body.img != null ? String(req.body.img).trim() : ''
    if (imgRaw) {
      try {
        assertManagedMediaUrls([imgRaw])
        img = imgRaw
      } catch (e) {
        return res.status(400).json({ error: e.message, code: e.code })
      }
    }

    // ── Resolve conversation ───────────────────────────────────────────────
    let conversation
    if (groupConvId) {
      // Group message — look up by ID and verify membership
      conversation = await Conversation.findById(groupConvId)
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
      const isMember = conversation.participants.some(p => idStr(p) === idStr(senderId))
      if (!isMember) return res.status(403).json({ error: 'Not a member of this group' })
    } else {
      // 1-to-1 — find or create
      conversation = await Conversation.findOne({ participants: { $all: [senderId, recipientId] }, isGroup: false })
      if (!conversation) {
        conversation = new Conversation({ participants: [senderId, recipientId], lastMessage: { text: message, sender: senderId } })
        await conversation.save()
      }
    }

    const { responseData } = await _persistAndBroadcastMessage({ conversation, senderId, message, img, replyTo })
    res.status(201).json(responseData)

  } catch (error) {
    console.error('Error in sendMessaeg:', error)
    if (!res.headersSent) res.status(500).json({ error: error.message || 'Failed to send message. Please try again.' })
  }
}



export const getMessage = async(req,res) => {
     const { otherUserId } = req.params
     const userId = req.user._id
     const { conversationId: directConvId } = req.query

     try {
    let conversation
    if (directConvId) {
      // Group or direct: look up by conversationId (passed as query param)
      conversation = await Conversation.findById(directConvId)
      if (!conversation) return res.status(200).json({ messages: [], hasMore: false })
      const isMember = conversation.participants.some(p => idStr(p) === idStr(userId))
      if (!isMember) return res.status(403).json({ error: 'Not a member' })
    } else {
      // 1-to-1 legacy path
      conversation = await Conversation.findOne({ participants: { $all: [userId, otherUserId] } })
      if (!conversation) return res.status(200).json({ messages: [], hasMore: false })
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || MESSAGES_PAGE_SIZE_DEFAULT, 1), 50)
    const cursorRaw = req.query.cursor != null ? String(req.query.cursor).trim() : ''
    const decodedCursor = decodeMessageCursor(cursorRaw)
    const beforeId = req.query.beforeId // legacy fallback

    let query = { conversationId: conversation._id }
    if (decodedCursor) {
      const cursorDate = new Date(decodedCursor.createdAtMs)
      const cursorOid = new mongoose.Types.ObjectId(decodedCursor.messageId)
      query = {
        ...query,
        $or: [
          { createdAt: { $lt: cursorDate } },
          { createdAt: cursorDate, _id: { $lt: cursorOid } },
        ],
      }
    } else if (beforeId) {
      const beforeMessage = await Message.findById(beforeId).select('createdAt _id').lean()
      if (beforeMessage?.createdAt && beforeMessage._id) {
        query = {
          ...query,
          $or: [
            { createdAt: { $lt: beforeMessage.createdAt } },
            { createdAt: beforeMessage.createdAt, _id: { $lt: beforeMessage._id } },
          ],
        }
      }
    }

    const messages = await Message.find(query)
      .populate('sender', 'username profilePic name')
      .populate('reactions.userId', 'username name profilePic')
      .populate({
        path: 'replyTo',
        select: 'text sender',
        populate: { path: 'sender', select: 'username name profilePic' },
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)

    const hasMore = messages.length > limit
    const messagesToReturn = hasMore ? messages.slice(0, limit) : messages
    messagesToReturn.reverse()

    const oldestInPage = messagesToReturn[0]
    const nextCursor = hasMore && oldestInPage?._id && oldestInPage?.createdAt
      ? encodeMessageCursor({
          messageId: oldestInPage._id,
          createdAtMs: new Date(oldestInPage.createdAt).getTime(),
        })
      : null

    res.status(200).json({ messages: messagesToReturn, hasMore, nextCursor })
  } catch(error) {
    res.status(500).json({ error: error.message })
    console.log(error)
  }
}


export const mycon = async(req,res) => {
 
	try {
		const userId = req.user._id  // Fix: Use authenticated user's _id
   
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || CONVERSATIONS_PAGE_SIZE_DEFAULT, 1), 50)
    const cursorRaw = req.query.cursor != null ? String(req.query.cursor).trim() : ''
    const decodedCursor = decodeConversationCursor(cursorRaw)
    const beforeId = req.query.beforeId // legacy fallback for older clients

    let paginationFilter = null
    if (decodedCursor) {
      const cursorDate = new Date(decodedCursor.updatedAtMs)
      const cursorOid = new mongoose.Types.ObjectId(decodedCursor.conversationId)
      paginationFilter = {
        $or: [
          { updatedAt: { $lt: cursorDate } },
          { updatedAt: cursorDate, _id: { $lt: cursorOid } },
        ],
      }
    } else if (beforeId) {
      const beforeConversation = await Conversation.findById(beforeId).select('updatedAt _id').lean()
      if (beforeConversation?.updatedAt && beforeConversation._id) {
        paginationFilter = {
          $or: [
            { updatedAt: { $lt: beforeConversation.updatedAt } },
            { updatedAt: beforeConversation.updatedAt, _id: { $lt: beforeConversation._id } },
          ],
        }
      }
    }

    /**
     * OPTIMIZED: Single aggregation instead of N+1 queries per conversation.
     * - Fetch conversations (sorted by updatedAt)
     * - Populate participants (and drop current user from participants array)
     * - Join last message (with populated sender)
     * - Compute unreadCount via lookup + $count
     */
    const matchStage = {
      participants: new mongoose.Types.ObjectId(userId),
      ...(paginationFilter || {}),
    }

    const conversationsAgg = await Conversation.aggregate([
      { $match: matchStage },
      { $sort: { updatedAt: -1, _id: -1 } },
      { $limit: limit + 1 },
      {
        $lookup: {
          from: 'users',
          localField: 'participants',
          foreignField: '_id',
          as: 'participants',
          pipeline: [
            { $project: { username: 1, profilePic: 1, name: 1, inCall: 1 } },
          ],
        },
      },
      ...buildConversationListEnrichmentStages(userId),
    ])

    const hasMore = conversationsAgg.length > limit
    const conversationsToReturn = hasMore ? conversationsAgg.slice(0, limit) : conversationsAgg
    const lastConversation = conversationsToReturn[conversationsToReturn.length - 1]
    const nextCursor = hasMore && lastConversation?._id && lastConversation?.updatedAt
      ? encodeConversationCursor({
          conversationId: lastConversation._id,
          updatedAtMs: new Date(lastConversation.updatedAt).getTime(),
        })
      : null

    res.status(200).json({
      conversations: conversationsToReturn,
      hasMore,
      nextCursor,
    });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
}

/** Fetch a single conversation the user belongs to (for push deep-links / group hydrate). */
export const getConversationById = async (req, res) => {
  try {
    const userId = req.user._id
    const convIdRaw = req.params.id != null ? String(req.params.id).trim() : ''
    if (!mongoose.isValidObjectId(convIdRaw)) {
      return res.status(400).json({ error: 'Invalid conversation id' })
    }

    const convOid = new mongoose.Types.ObjectId(convIdRaw)
    const userOid = new mongoose.Types.ObjectId(userId)

    const conversationsAgg = await Conversation.aggregate([
      { $match: { _id: convOid, participants: userOid } },
      {
        $lookup: {
          from: 'users',
          localField: 'participants',
          foreignField: '_id',
          as: 'participants',
          pipeline: [
            { $project: { username: 1, profilePic: 1, name: 1, inCall: 1 } },
          ],
        },
      },
      ...buildConversationListEnrichmentStages(userId),
    ])

    if (!conversationsAgg.length) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    res.status(200).json({ conversation: conversationsAgg[0] })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

/** Search user's conversations by group name or DM partner name/username. */
export const searchConversations = async (req, res) => {
  try {
    const userId = req.user._id
    const rawQ = req.query.q != null ? String(req.query.q).trim() : ''
    if (rawQ.length < 2) {
      return res.status(200).json({ conversations: [] })
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 30)
    const pattern = escapeRegexLiteral(rawQ)
    const userOid = new mongoose.Types.ObjectId(userId)

    const conversationsAgg = await Conversation.aggregate([
      { $match: { participants: userOid } },
      {
        $lookup: {
          from: 'users',
          localField: 'participants',
          foreignField: '_id',
          as: 'participants',
          pipeline: [
            { $project: { username: 1, profilePic: 1, name: 1, inCall: 1 } },
          ],
        },
      },
      {
        $match: {
          $or: [
            { isGroup: true, groupName: { $regex: pattern, $options: 'i' } },
            {
              isGroup: { $ne: true },
              participants: {
                $elemMatch: {
                  _id: { $ne: userOid },
                  $or: [
                    { name: { $regex: pattern, $options: 'i' } },
                    { username: { $regex: pattern, $options: 'i' } },
                  ],
                },
              },
            },
          ],
        },
      },
      { $sort: { updatedAt: -1, _id: -1 } },
      { $limit: limit },
      ...buildConversationListEnrichmentStages(userId),
    ])

    res.status(200).json({ conversations: conversationsAgg })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}


// Get total unread message count — Redis cache with DB fallback
export const getTotalUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id
    const totalUnread = await getTotalUnread(userId)
    res.status(200).json({ totalUnread })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

/** DELETE /api/message/conversation/:id — DM-only; both participants get a targeted tombstone. */
export const deletconversation = async (req, res) => {
  try {
    const requesterId = idStr(req.user?._id)
    const convId = req.params.id
    if (!requesterId) return res.status(401).json({ error: 'Unauthorized' })
    if (!convId || !mongoose.Types.ObjectId.isValid(convId)) {
      return res.status(400).json({ error: 'Invalid conversation id' })
    }

    const conversation = await Conversation.findById(convId).select(
      '_id isGroup participants groupAvatar',
    )
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }
    // Groups use DELETE /api/message/group/:id (admin-only).
    if (conversation.isGroup) {
      return res.status(400).json({ error: 'Use group delete endpoint for groups' })
    }

    const participantIds = (conversation.participants || [])
      .map((p) => idStr(p))
      .filter(Boolean)
    if (participantIds.length !== 2 || !participantIds.includes(requesterId)) {
      return res.status(403).json({ error: 'Not authorized to delete this conversation' })
    }

    const convIdStr = idStr(conversation._id)

    await destroyMediaAssetsForConversation(conversation._id)
    if (conversation.groupAvatar && isManagedMediaUrl(String(conversation.groupAvatar))) {
      await destroyMediaAssetForMessageImgUrl(conversation.groupAvatar)
    }
    await Message.deleteMany({ conversationId: conversation._id })
    await Conversation.findByIdAndDelete(conversation._id)
    await clearConversationUnreadForUsers(participantIds, convIdStr)

    // Emit AFTER commit — O(1) fan-out to each user's self room (all tabs/devices).
    const io = getIO()
    if (io) {
      const payload = { conversationId: convIdStr }
      for (const uid of participantIds) {
        const selfRoom = getUserSelfRoomId(uid)
        if (selfRoom) io.to(selfRoom).emit('conversationDeleted', payload)
      }
      for (const uid of participantIds) {
        emitUnreadCountUpdate(io, uid, getUserSocket).catch(() => {})
      }
    }

    res.status(200).json('all deleted')
  } catch (error) {
    res.status(500).json({ error: error.message })
    console.log(error)
  }
}

// Delete a single message
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params
    const userId = req.user._id

    const message = await Message.findById(messageId)
    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // Check if user is a participant in the conversation (any participant can delete any message)
    const conversation = await Conversation.findById(message.conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const isParticipant = conversation.participants.some(
      participantId => participantId.toString() === userId.toString()
    )

    if (!isParticipant) {
      return res.status(403).json({ error: 'You can only delete messages in conversations you are part of' })
    }

    if (message.img && isManagedMediaUrl(String(message.img))) {
      try {
        await destroyMediaAssetForMessageImgUrl(message.img)
      } catch (deleteError) {
        console.error('Error deleting message media:', deleteError)
      }
    }

    // Delete the message
    await Message.findByIdAndDelete(messageId)

    // Emit only to participants in this conversation (not a global broadcast).
    // Conversation room + each participant's self room: room membership can lag
    // right after reconnect, which made deletion "sometimes" miss the other user.
    if (conversation) {
      const io = getIO()
      if (io) {
        const payload = {
          conversationId: message.conversationId.toString(),
          messageId: messageId,
        }
        io.to(message.conversationId.toString()).emit('messageDeleted', payload)
        for (const pid of conversation.participants || []) {
          const selfRoom = getUserSelfRoomId(idStr(pid))
          if (selfRoom) io.to(selfRoom).emit('messageDeleted', payload)
        }
      }
    }

    res.status(200).json({ message: 'Message deleted successfully' })
  } catch (error) {
    res.status(500).json({ error: error.message })
    console.log(error)
  }
}

// Add or remove reaction to a message
export const toggleReaction = async (req, res) => {
  try {
    const { messageId } = req.params
    const { emoji } = req.body
    const userId = req.user._id

    const message = await Message.findById(messageId)
    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // Check if user already has ANY reaction on this message
    const existingUserReactionIndex = message.reactions.findIndex(
      r => r.userId.toString() === userId.toString()
    )

    if (existingUserReactionIndex > -1) {
      const existingReaction = message.reactions[existingUserReactionIndex]
      // If user clicked the same emoji, remove it
      if (existingReaction.emoji === emoji) {
        message.reactions.splice(existingUserReactionIndex, 1)
      } else {
        // Replace old reaction with new one
        message.reactions[existingUserReactionIndex].emoji = emoji
      }
    } else {
      // User doesn't have any reaction yet, add new one
      message.reactions.push({ userId, emoji })
    }

    await message.save()
    
    // Populate userId in reactions for response
    await message.populate('reactions.userId', 'username name profilePic')

    // Emit only to participants in this conversation (not a global broadcast)
    const conversation = await Conversation.findById(message.conversationId)
    if (conversation) {
      const io = getIO()
      if (io) {
        io.to(message.conversationId.toString()).emit("messageReactionUpdated", {
          conversationId: message.conversationId.toString(),
          messageId: message._id.toString(),
        })
      }
    }

    res.status(200).json(message)
  } catch (error) {
    res.status(500).json({ error: error.message })
    console.log(error)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  GROUP CONVERSATION HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

/** POST /api/message/group  — create a new group conversation */
export const createGroup = async (req, res) => {
  try {
    const adminId = req.user._id
    const { groupName, participantIds } = req.body

    const normalizedGroupName = typeof groupName === 'string' ? groupName.trim() : ''
    if (!normalizedGroupName) {
      return res.status(400).json({ error: 'groupName is required' })
    }
    if (!Array.isArray(participantIds) || participantIds.length < 1) {
      return res.status(400).json({ error: 'At least one other participant is required' })
    }

    const uniqueIds = [...new Set([idStr(adminId), ...participantIds.map(idStr)])]
      .filter(id => mongoose.isValidObjectId(id))
      .map(id => new mongoose.Types.ObjectId(id))

    // Idempotency guard: avoid creating duplicate groups from rapid double-submit.
    const existing = await Conversation.findOne({
      isGroup: true,
      admin: adminId,
      groupName: normalizedGroupName,
      participants: { $all: uniqueIds },
      $expr: { $eq: [{ $size: '$participants' }, uniqueIds.length] },
    }).populate('participants', 'username profilePic name')
    if (existing) {
      return res.status(200).json(existing)
    }

    const conversation = await Conversation.create({
      participants: uniqueIds,
      isGroup: true,
      groupName: normalizedGroupName,
      admin: adminId,
      lastMessage: { text: '', sender: adminId },
    })

    await conversation.populate('participants', 'username profilePic name')

    const io = getIO()
    const roomId = idStr(conversation._id)
    if (io) {
      // Join ALL online participants (including admin) to the new room immediately.
      // Without this, users added to a group while already connected never receive
      // real-time messages because the "join all rooms on connect" only ran at connect time.
      const allUids = [idStr(adminId), ...participantIds.map(idStr)]
      for (const uid of allUids) {
        const recipSocket = await getUserSocket(uid).catch(() => null)
        if (recipSocket?.socketId) {
          const liveSock = io.sockets.sockets.get(recipSocket.socketId)
          if (liveSock) liveSock.join(roomId)
        }
      }
      io.to(`userSelf:${idStr(adminId)}`).emit('groupCreated', conversation.toObject())
      for (const uid of participantIds) {
        const recipSocket = await getUserSocket(idStr(uid)).catch(() => null)
        if (recipSocket?.socketId) io.to(recipSocket.socketId).emit('groupCreated', conversation.toObject())
      }
    }

    // Push notification to other members
    try {
      const { sendGroupAddedNotification } = await import('../services/pushNotifications.js')
      await Promise.allSettled(
        participantIds.map(uid =>
          sendGroupAddedNotification(idStr(uid), req.user.name || req.user.username, normalizedGroupName, idStr(conversation._id))
        )
      )
    } catch (_) {}

    res.status(201).json(conversation)
  } catch (error) {
    console.error('createGroup error:', error)
    res.status(500).json({ error: error.message })
  }
}

/** PUT /api/message/group/:id  — rename group or update avatar (admin only) */
export const updateGroupInfo = async (req, res) => {
  try {
    const userId = req.user._id
    const conversation = await Conversation.findById(req.params.id)
    if (!conversation || !conversation.isGroup) return res.status(404).json({ error: 'Group not found' })
    if (idStr(conversation.admin) !== idStr(userId)) return res.status(403).json({ error: 'Only admin can update group info' })

    const { groupName, groupAvatar } = req.body
    if (groupName && typeof groupName === 'string') conversation.groupName = groupName.trim()
    if (typeof groupAvatar === 'string') conversation.groupAvatar = groupAvatar

    await conversation.save()
    await conversation.populate('participants', 'username profilePic name')

    const io = getIO()
    if (io) io.to(idStr(conversation._id)).emit('groupInfoUpdated', { conversationId: idStr(conversation._id), groupName: conversation.groupName, groupAvatar: conversation.groupAvatar })

    res.status(200).json(conversation)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

/** POST /api/message/group/:id/members  — admin adds a member */
export const addGroupMember = async (req, res) => {
  try {
    const adminId = req.user._id
    const { userId: newUserId } = req.body
    const conversation = await Conversation.findById(req.params.id)
    if (!conversation || !conversation.isGroup) return res.status(404).json({ error: 'Group not found' })
    if (idStr(conversation.admin) !== idStr(adminId)) return res.status(403).json({ error: 'Only admin can add members' })
    if (!mongoose.isValidObjectId(newUserId)) return res.status(400).json({ error: 'Invalid userId' })

    const alreadyMember = conversation.participants.some(p => idStr(p) === idStr(newUserId))
    if (alreadyMember) return res.status(400).json({ error: 'User already a member' })

    conversation.participants.push(new mongoose.Types.ObjectId(newUserId))
    await conversation.save()
    await conversation.populate('participants', 'username profilePic name')

    const io = getIO()
    if (io) {
      io.to(idStr(conversation._id)).emit('groupMemberAdded', { conversationId: idStr(conversation._id), participant: conversation.participants.find(p => idStr(p._id) === idStr(newUserId)) })
      const recipSocket = await getUserSocket(idStr(newUserId)).catch(() => null)
      if (recipSocket?.socketId) {
        // Join the new member's live socket to the room so they receive future messages immediately
        const liveSock = io.sockets.sockets.get(recipSocket.socketId)
        if (liveSock) liveSock.join(idStr(conversation._id))
        io.to(recipSocket.socketId).emit('groupCreated', conversation.toObject())
      }
    }

    try {
      const { sendGroupAddedNotification } = await import('../services/pushNotifications.js')
      await sendGroupAddedNotification(idStr(newUserId), req.user.name || req.user.username, conversation.groupName, idStr(conversation._id))
    } catch (_) {}

    res.status(200).json(conversation)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

/** DELETE /api/message/group/:id/members/:userId  — admin removes a member */
export const removeGroupMember = async (req, res) => {
  try {
    const adminId = req.user._id
    const targetId = req.params.userId
    const conversation = await Conversation.findById(req.params.id)
    if (!conversation || !conversation.isGroup) return res.status(404).json({ error: 'Group not found' })
    if (idStr(conversation.admin) !== idStr(adminId)) return res.status(403).json({ error: 'Only admin can remove members' })
    if (idStr(targetId) === idStr(adminId)) return res.status(400).json({ error: 'Admin cannot remove themselves. Leave the group instead.' })

    conversation.participants = conversation.participants.filter(p => idStr(p) !== idStr(targetId))
    await conversation.save()

    const io = getIO()
    if (io) {
      io.to(idStr(conversation._id)).emit('groupMemberRemoved', { conversationId: idStr(conversation._id), userId: idStr(targetId) })
      const recipSocket = await getUserSocket(idStr(targetId)).catch(() => null)
      if (recipSocket?.socketId) io.to(recipSocket.socketId).emit('removedFromGroup', { conversationId: idStr(conversation._id) })
    }

    try {
      const { sendGroupRemovedNotification } = await import('../services/pushNotifications.js')
      await sendGroupRemovedNotification(idStr(targetId), conversation.groupName, idStr(conversation._id))
    } catch (_) {}

    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

/** DELETE /api/message/group/:id  — admin deletes the entire group */
export const deleteGroup = async (req, res) => {
  try {
    const adminId = req.user._id
    const conversation = await Conversation.findById(req.params.id)
    if (!conversation || !conversation.isGroup) return res.status(404).json({ error: 'Group not found' })
    if (idStr(conversation.admin) !== idStr(adminId)) return res.status(403).json({ error: 'Only admin can delete the group' })

    const conversationId = idStr(conversation._id)
    const participantIds = (conversation.participants || [])
      .map((p) => idStr(p))
      .filter(Boolean)

    await destroyMediaAssetsForConversation(conversation._id)
    if (conversation.groupAvatar && isManagedMediaUrl(String(conversation.groupAvatar))) {
      await destroyMediaAssetForMessageImgUrl(conversation.groupAvatar)
    }
    await Message.deleteMany({ conversationId: conversation._id })
    await Conversation.findByIdAndDelete(conversation._id)
    await clearConversationUnreadForUsers(participantIds, conversationId)

    // Emit AFTER commit — conversation room + each member's self room (list updates
    // even if a socket hasn't joined the group room yet). Still O(members), never global.
    const io = getIO()
    if (io) {
      const payload = { conversationId }
      io.to(conversationId).emit('groupDeleted', payload)
      for (const uid of participantIds) {
        const selfRoom = getUserSelfRoomId(uid)
        if (selfRoom) io.to(selfRoom).emit('groupDeleted', payload)
      }
      for (const uid of participantIds) {
        emitUnreadCountUpdate(io, uid, getUserSocket).catch(() => {})
      }
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

/** POST /api/message/group/:id/leave  — any member leaves the group */
export const leaveGroup = async (req, res) => {
  try {
    const userId = req.user._id
    const conversation = await Conversation.findById(req.params.id)
    if (!conversation || !conversation.isGroup) return res.status(404).json({ error: 'Group not found' })

    const isMember = conversation.participants.some(p => idStr(p) === idStr(userId))
    if (!isMember) return res.status(400).json({ error: 'Not a member of this group' })

    conversation.participants = conversation.participants.filter(p => idStr(p) !== idStr(userId))

    // If admin leaves, transfer admin to the first remaining member (if any)
    if (idStr(conversation.admin) === idStr(userId) && conversation.participants.length > 0) {
      conversation.admin = conversation.participants[0]
    }

    if (conversation.participants.length === 0) {
      const emptyConvId = conversation._id
      await destroyMediaAssetsForConversation(emptyConvId)
      if (conversation.groupAvatar && isManagedMediaUrl(String(conversation.groupAvatar))) {
        await destroyMediaAssetForMessageImgUrl(conversation.groupAvatar)
      }
      await Message.deleteMany({ conversationId: emptyConvId })
      await Conversation.findByIdAndDelete(emptyConvId)
    } else {
      await conversation.save()
      const io = getIO()
      if (io) io.to(idStr(conversation._id)).emit('groupMemberLeft', { conversationId: idStr(conversation._id), userId: idStr(userId), newAdmin: idStr(conversation.admin) })
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}