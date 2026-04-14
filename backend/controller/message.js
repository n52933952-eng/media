import Conversation from '../models/conversation.js'
import Message from '../models/message.js'
import { getRecipientSockedId, getIO, getUserSocket, isUserEffectivelyOnline } from '../socket/socket.js'
import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'
import mongoose from 'mongoose'

// ── helpers ────────────────────────────────────────────────────────────────
const idStr = (id) => (id != null ? id.toString() : '')

/**
 * Broadcast to a Socket.IO conversation room (all online members) and send
 * FCM push to participants who are NOT currently in the room (offline).
 */
async function broadcastToConversation(conversationId, event, payload, excludeSenderId, participantIds, senderPopulated, groupName) {
  const io = getIO()
  const roomId = idStr(conversationId)
  if (io) {
    io.to(roomId).emit(event, payload)
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
          const recipientConversations = await Conversation.find({ participants: recipientId })
          const totalUnread = await Promise.all(
            recipientConversations.map(async (conv) => {
              const unreadCount = await Message.countDocuments({
                conversationId: conv._id,
                seen: false,
                sender: { $ne: recipientId },
              })
              return unreadCount || 0
            })
          )
          const totalUnreadCount = totalUnread.reduce((sum, count) => sum + count, 0)
          io.to(recipientSocketId).emit('unreadCountUpdate', { totalUnread: totalUnreadCount })
        } catch (error) {
          console.log('Error calculating unread count:', error)
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

      // Notify sender immediately if they're connected via socket.
      try {
        const senderSocket = await getUserSocket(senderStr)
        const senderSocketId = senderSocket?.socketId
        if (senderSocketId) {
          const io = getIO()
          io.to(senderSocketId).emit('messageDelivered', {
            messageId: msg._id.toString(),
            conversationId: convId,
          })
        }
      } catch {
        // best-effort
      }
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.warn('ackMessageDeliveredHttp error:', e?.message || e)
    return res.status(500).json({ ok: false, error: 'server_error' })
  }
}

/** Core send logic shared between file-upload and plain-text paths */
async function _persistAndBroadcastMessage({ conversation, senderId, message, img, replyTo }) {
  const newMessage = new Message({
    conversationId: conversation._id,
    sender: senderId,
    text: message,
    img: img || '',
    replyTo: replyTo || null,
  })

  conversation.lastMessage = { text: message, sender: senderId }
  conversation.updatedAt = new Date()

  await Promise.all([newMessage.save(), conversation.save()])

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

    // ── File upload path ───────────────────────────────────────────────────
    if (req.file) {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
            folder: 'messages',
            timeout: 1200000,
            chunk_size: 6000000,
          },
          async (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error)
              if (!res.headersSent) res.status(500).json({ error: 'Failed to upload file', details: error.message })
              return reject(error)
            }
            img = result.secure_url
            try {
              const { responseData } = await _persistAndBroadcastMessage({ conversation, senderId, message, img, replyTo })
              if (!res.headersSent) res.status(201).json(responseData)
              resolve()
            } catch (e) {
              if (!res.headersSent) res.status(500).json({ error: e.message || 'Failed to send message' })
              reject(e)
            }
          }
        )
        const bufferStream = new Readable()
        bufferStream.push(req.file.buffer)
        bufferStream.push(null)
        bufferStream.pipe(stream)
      })
    }

    // ── Plain text/media path ──────────────────────────────────────────────
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

    const limit = parseInt(req.query.limit) || 12
    const beforeId = req.query.beforeId

    let query = { conversationId: conversation._id }
    if (beforeId) {
      const beforeMessage = await Message.findById(beforeId)
      if (beforeMessage) query.createdAt = { $lt: beforeMessage.createdAt }
    }

    const messages = await Message.find(query)
      .populate('sender', 'username profilePic name')
      .populate('reactions.userId', 'username name profilePic')
      .populate({
        path: 'replyTo',
        select: 'text sender',
        populate: { path: 'sender', select: 'username name profilePic' },
      })
      .sort({ createdAt: -1 })
      .limit(limit + 1)

    const hasMore = messages.length > limit
    const messagesToReturn = hasMore ? messages.slice(0, limit) : messages
    messagesToReturn.reverse()

    res.status(200).json({ messages: messagesToReturn, hasMore })
  } catch(error) {
    res.status(500).json(error)
    console.log(error)
  }
}


export const mycon = async(req,res) => {
 
	try {
		const userId = req.user._id  // Fix: Use authenticated user's _id
   
    // Pagination parameters
    const limit = parseInt(req.query.limit) || 20 // Default to 20 conversations
    const beforeId = req.query.beforeId // Conversation ID to fetch conversations before (for pagination)
    
    // If beforeId is provided, fetch its updatedAt once (used for pagination)
    let beforeUpdatedAt = null
    if (beforeId) {
      const beforeConversation = await Conversation.findById(beforeId).select('updatedAt').lean()
      if (beforeConversation?.updatedAt) beforeUpdatedAt = beforeConversation.updatedAt
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
      ...(beforeUpdatedAt ? { updatedAt: { $lt: beforeUpdatedAt } } : {}),
    }

    const conversationsAgg = await Conversation.aggregate([
      { $match: matchStage },
      { $sort: { updatedAt: -1 } },
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
      // For 1-on-1 conversations remove current user so participants[0] is the other person.
      // For group conversations keep everyone so the group info shows all members.
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
                  cond: { $ne: ['$$p._id', new mongoose.Types.ObjectId(userId)] },
                },
              },
            },
          },
        },
      },
      // Lookup last message (newest by createdAt) and populate sender
      {
        $lookup: {
          from: 'messages',
          let: { convId: '$_id' },
          as: '__lastMessageDoc',
          pipeline: [
            { $match: { $expr: { $eq: ['$conversationId', '$$convId'] } } },
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
            { $project: { text: 1, sender: 1, createdAt: 1 } },
          ],
        },
      },
      {
        $addFields: {
          lastMessage: { $arrayElemAt: ['$__lastMessageDoc', 0] },
        },
      },
      // Lookup unread count (seen=false AND sender != current user)
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
                    { $ne: ['$sender', new mongoose.Types.ObjectId(userId)] },
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
      { $project: { __lastMessageDoc: 0, __unread: 0 } },
    ])

    const hasMore = conversationsAgg.length > limit
    const conversationsToReturn = hasMore ? conversationsAgg.slice(0, limit) : conversationsAgg

    // NOTE: totalCount removed (expensive). Use hasMore for pagination (same as mobile/web usage).
    res.status(200).json({
      conversations: conversationsToReturn,
      hasMore,
    });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
}


// Get total unread message count — single aggregation (no N+1 queries)
export const getTotalUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id
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
          sender: { $ne: new mongoose.Types.ObjectId(String(userId)) },
          'conv.participants': new mongoose.Types.ObjectId(String(userId)),
        },
      },
      { $count: 'totalUnread' },
    ])
    res.status(200).json({ totalUnread: result[0]?.totalUnread ?? 0 })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

export const deletconversation =async (req,res) => {
 


  try{
  
  
 await Message.deleteMany({conversationId:req.params.id})

await Conversation.findByIdAndDelete(req.params.id)
res.status(200).json("all deleted")
}
 catch(error){
     res.status(500).json(error)
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

    // Delete image/video from Cloudinary if it exists
    if (message.img && message.img.includes('cloudinary')) {
      try {
        // Determine resource type (image or video)
        const isVideo = message.img.includes('/video/upload/') || 
                       message.img.match(/\.(mp4|webm|ogg|mov)$/i) ||
                       (message.img.includes('cloudinary') && message.img.includes('video'))
        
        // Extract public ID from Cloudinary URL
        // URL format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{version}/{folder}/{filename}.{ext}
        // We need to extract: {folder}/{filename} (public ID)
        const urlParts = message.img.split('/')
        const uploadIndex = urlParts.findIndex(part => part === 'upload')
        
        if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
          // Get everything after 'upload' (skip version if present)
          let publicIdParts = urlParts.slice(uploadIndex + 1)
          
          // Remove version if it's a numeric v{timestamp}
          if (publicIdParts.length > 0 && /^v\d+$/.test(publicIdParts[0])) {
            publicIdParts = publicIdParts.slice(1)
          }
          
          // Join remaining parts to get public ID
          let publicId = publicIdParts.join('/')
          
          // Remove file extension
          publicId = publicId.replace(/\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|ogg|mov)$/i, '')
          
          // Delete from Cloudinary
          if (publicId) {
            await cloudinary.uploader.destroy(publicId, {
              resource_type: isVideo ? 'video' : 'image'
            })
            console.log(`Deleted ${isVideo ? 'video' : 'image'} from Cloudinary: ${publicId}`)
          }
        } else {
          // Fallback: try to extract public ID using simpler method
          const filename = urlParts[urlParts.length - 1]
          const publicId = filename.split('.')[0]
          if (publicId) {
            await cloudinary.uploader.destroy(publicId, {
              resource_type: isVideo ? 'video' : 'image'
            })
            console.log(`Deleted ${isVideo ? 'video' : 'image'} from Cloudinary (fallback): ${publicId}`)
          }
        }
      } catch (cloudinaryError) {
        // Log error but don't fail the message deletion
        console.error('Error deleting file from Cloudinary:', cloudinaryError)
        // Continue with message deletion even if Cloudinary deletion fails
      }
    }

    // Delete the message
    await Message.findByIdAndDelete(messageId)

    // Emit only to participants in this conversation (not a global broadcast)
    if (conversation) {
      const io = getIO()
      if (io) {
        io.to(message.conversationId.toString()).emit("messageDeleted", {
          conversationId: message.conversationId.toString(),
          messageId: messageId,
        })
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

    if (!groupName || typeof groupName !== 'string' || !groupName.trim()) {
      return res.status(400).json({ error: 'groupName is required' })
    }
    if (!Array.isArray(participantIds) || participantIds.length < 1) {
      return res.status(400).json({ error: 'At least one other participant is required' })
    }

    const uniqueIds = [...new Set([idStr(adminId), ...participantIds.map(idStr)])]
      .filter(id => mongoose.isValidObjectId(id))
      .map(id => new mongoose.Types.ObjectId(id))

    const conversation = await Conversation.create({
      participants: uniqueIds,
      isGroup: true,
      groupName: groupName.trim(),
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
          sendGroupAddedNotification(idStr(uid), req.user.name || req.user.username, groupName.trim(), idStr(conversation._id))
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

    // Notify all members before deleting
    const io = getIO()
    if (io) {
      io.to(conversationId).emit('groupDeleted', { conversationId })
    }

    // Clean up database
    await Message.deleteMany({ conversationId: conversation._id })
    await Conversation.findByIdAndDelete(conversation._id)

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
      // Empty group: delete it
      await Conversation.findByIdAndDelete(conversation._id)
      await Message.deleteMany({ conversationId: conversation._id })
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