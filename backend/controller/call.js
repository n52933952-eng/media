import User from '../models/user.js'
import Conversation from '../models/conversation.js'
import { getIO, getRecipientSockedId } from '../socket/socket.js'
import * as redisService from '../services/redis.js'
import { AccessToken } from 'livekit-server-sdk'

/** Same idea as socket `normalizeUserId` — compare participant ids reliably. */
const sameId = (a, b) => String(a ?? '').trim() === String(b ?? '').trim()

// ─── LiveKit helpers ────────────────────────────────────────────────────────

const LIVEKIT_API_KEY    = process.env.LIVEKIT_API_KEY
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET
const LIVEKIT_URL        = process.env.LIVEKIT_URL

/**
 * Build a deterministic room name so both participants always land in the
 * same room without storing anything in the database.
 *
 *  type        roomName
 *  ─────────── ────────────────────────────────────
 *  direct      call_<smallerId>_<largerId>
 *  group       group_<conversationId>
 *  livestream  live_<streamerId>
 *  viewer      live_<streamerId>   (same room, subscribe-only)
 */
const buildRoomName = ({ type, userId, targetId, conversationId }) => {
    switch (type) {
        case 'group':
            return `group_${conversationId}`
        case 'livestream':
        case 'viewer':
            return `live_${targetId || userId}`   // targetId = streamerId for viewers
        default: {                                  // 'direct'
            const ids = [String(userId), String(targetId)].sort()
            return `call_${ids[0]}_${ids[1]}`
        }
    }
}

/**
 * POST /api/call/token
 * Generate a LiveKit access token for the requesting user.
 *
 * Body:
 *   type           'direct' | 'group' | 'livestream' | 'viewer'
 *   targetId       other user's _id  (direct calls & viewers passing streamerId)
 *   conversationId group conversation _id (group calls)
 *
 * Returns:
 *   { token, roomName, livekitUrl }
 */
export const getLiveKitToken = async (req, res) => {
    try {
        const userId   = String(req.user._id)
        const userName = req.user.name || req.user.username || userId
        const { type = 'direct', targetId, conversationId } = req.body

        if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
            return res.status(500).json({ error: 'LiveKit not configured on server' })
        }

        if (type === 'group') {
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId required for group calls' })
            }
            const conv = await Conversation.findById(conversationId).select('participants').lean()
            if (!conv) {
                return res.status(404).json({ error: 'Conversation not found' })
            }
            const member = (conv.participants || []).some((p) => sameId(p, userId))
            if (!member) {
                return res.status(403).json({ error: 'Not a member of this conversation' })
            }
        }

        const roomName = buildRoomName({ type, userId, targetId, conversationId })

        const canPublish   = type !== 'viewer'   // viewers only watch
        const canSubscribe = true                 // everyone can receive streams

        // Cost-control policy: cap all LiveKit sessions at 25 minutes.
        const ttl = '25m'
        const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: userId,
            name:     userName,
            ttl,
        })

        at.addGrant({
            roomJoin:       true,
            room:           roomName,
            canPublish,
            canSubscribe,
            canPublishData: true,
        })

        const token = await at.toJwt()

        console.log(`✅ [LiveKit] Token issued — user:${userId} room:${roomName} type:${type}`)

        return res.status(200).json({ token, roomName, livekitUrl: LIVEKIT_URL })
    } catch (error) {
        console.error('❌ [getLiveKitToken]', error.message)
        return res.status(500).json({ error: 'Failed to generate LiveKit token' })
    }
}

// ─── ICE servers (kept for any legacy fallback — safe to leave) ─────────────

const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
]

export const getIceServers = async (req, res) => {
    try {
        const servers  = [...STUN_SERVERS]
        const username = process.env.TURN_USERNAME
        const credential = process.env.TURN_CREDENTIAL
        if (username && credential) {
            servers.push(
                { urls: 'turn:global.relay.metered.ca:80',               username, credential },
                { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username, credential },
                { urls: 'turn:global.relay.metered.ca:443',              username, credential },
                { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username, credential },
            )
        }
        return res.status(200).json({ iceServers: servers })
    } catch (error) {
        console.error('❌ [getIceServers]', error)
        return res.status(500).json({ error: 'Failed to get ICE servers' })
    }
}

// ─── Redis helpers (used by cancelCall below) ───────────────────────────────

const getActiveCall = async (callId) => {
    if (!redisService.isRedisAvailable()) return null
    try { return await redisService.redisGet(`activeCall:${callId}`) || null }
    catch (e) { console.error(`❌ [call] getActiveCall ${callId}:`, e.message); return null }
}

const deleteActiveCall = async (callId) => {
    if (!redisService.isRedisAvailable()) return
    try { await redisService.redisDel(`activeCall:${callId}`) }
    catch (e) { console.error(`❌ [call] deleteActiveCall ${callId}:`, e.message) }
}

const deletePendingCall = async (receiverId) => {
    if (!redisService.isRedisAvailable()) return
    try { await redisService.redisDel(`pendingCall:${receiverId}`) }
    catch (e) { console.error(`❌ [call] deletePendingCall ${receiverId}:`, e.message) }
}

const clearInCall = async (userId) => {
    if (!redisService.isRedisAvailable() || !userId) return
    try { await redisService.redisDel(`inCall:${String(userId).trim()}`) }
    catch (e) { console.error(`❌ [call] clearInCall ${userId}:`, e.message) }
}

// ─── HTTP cancel (kept — FCM offline cancel still uses this) ────────────────

/**
 * POST /api/call/cancel
 * Allows canceling calls even when the app is killed (no socket).
 * FCM push + socket notify both sides.
 */
export const cancelCall = async (req, res) => {
    try {
        const { conversationId, sender } = req.body
        if (!conversationId || !sender) {
            return res.status(400).json({ success: false, error: 'Missing conversationId or sender' })
        }

        console.log(`📴 [HTTP cancelCall] Canceling call`, { conversationId, sender })

        const callerSocketId   = await getRecipientSockedId(conversationId)
        const receiverSocketId = await getRecipientSockedId(sender)

        // Clean Redis call state
        const callId1 = `${sender}-${conversationId}`
        const callId2 = `${conversationId}-${sender}`
        const [call1, call2] = await Promise.all([getActiveCall(callId1), getActiveCall(callId2)])
        if (call1) await deleteActiveCall(callId1)
        if (call2) await deleteActiveCall(callId2)
        await Promise.all([deletePendingCall(sender), deletePendingCall(conversationId)])
        await Promise.all([clearInCall(sender), clearInCall(conversationId)])

        // Update MongoDB (fire-and-forget)
        Promise.all([
            User.findByIdAndUpdate(sender,         { inCall: false }).catch(() => {}),
            User.findByIdAndUpdate(conversationId, { inCall: false }).catch(() => {}),
        ])

        // FCM stop-ringtone push (keeps offline ringing working)
        try {
            const { sendCallEndedNotificationToUser } = await import('../services/fcmNotifications.js')
            await sendCallEndedNotificationToUser(conversationId, sender)
            console.log('✅ [HTTP cancelCall] FCM call-ended sent')
        } catch (fcmErr) {
            console.error('❌ [HTTP cancelCall] FCM error:', fcmErr.message)
        }

        // Socket notify both sides
        const io = getIO()
        if (io) {
            if (callerSocketId)   io.to(callerSocketId).emit('CallCanceled')
            if (receiverSocketId) io.to(receiverSocketId).emit('CallCanceled')
            io.emit('cancleCall', { userToCall: conversationId, from: sender })
        }

        return res.status(200).json({ success: true })
    } catch (error) {
        console.error('❌ [HTTP cancelCall]', error)
        return res.status(500).json({ success: false, error: error.message })
    }
}
