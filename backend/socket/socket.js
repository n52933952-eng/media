
import { Server } from 'socket.io'
import http from 'http'
import mongoose from 'mongoose'
import Message from '../models/message.js'
import Conversation from '../models/conversation.js'
import User from '../models/user.js'
import { createChessGamePost, deleteChessGamePost, createCardGamePost, deleteCardGamePost } from '../controller/post.js'
import LiveStream from '../models/liveStream.js'
import * as redisService from '../services/redis.js'
import { sendCallNotification, sendMissedCallNotification } from '../services/pushNotifications.js'
// Use redisService namespace for all Redis functions to avoid import issues
const { getRedis, isRedisAvailable } = redisService

// This will be set from index.js
let io = null
let server = null

    // In-memory fallback (will be gradually replaced by Redis)
    const userSocketMap = {}
    // Track active calls: { callId: { user1, user2 } } - NOW IN REDIS
    // Track chess game rooms: { roomId: [socketId1, socketId2, ...] } - NOW IN REDIS
    // Track active chess games: { userId: roomId } - to know which game a user is in
    const activeChessGames = new Map()
    // Track chess game state: { roomId: { fen, capturedWhite, capturedBlack } }
    const chessGameStates = new Map()
    
    // Prevent infinite loops - track if we're already emitting online users
    let isEmittingOnlineUsers = false
    let emitOnlineUsersTimeout = null

// ============================================================
// Presence optimization (backwards-compatible)
// - New: clients can subscribe to presence updates for a subset of userIds
// - Server emits `presenceUpdate` events to rooms: `presence:<userId>`
// - Old behavior (`getOnlineUser` full broadcast) remains for legacy clients
// ============================================================
const PRESENCE_ROOM_PREFIX = 'presence:'
const PRESENCE_KEY_PREFIX = 'userPresence:'
/** Queued WebRTC answer SDP when caller socket drops before callee answers (Wi‑Fi / reconnect race). */
const PENDING_ANSWER_PREFIX = 'pendingAnswer:'
const LIVEKIT_DEFAULT_MAX_SESSION_MS = 25 * 60 * 1000
const LIVEKIT_MAX_SESSION_MS = (() => {
    const raw = Number(process.env.LIVEKIT_MAX_SESSION_MS || LIVEKIT_DEFAULT_MAX_SESSION_MS)
    return Number.isFinite(raw) && raw > 0 ? raw : LIVEKIT_DEFAULT_MAX_SESSION_MS
})()
const livekitDirectCallTimers = new Map()
const livekitGroupCallTimers = new Map()
const livekitStreamTimers = new Map()

const setUserPresence = async (userId, status) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(userId)
    if (!uid) return
    // Keep a TTL so stale presence can't live forever.
    await redisService.redisSet(`${PRESENCE_KEY_PREFIX}${uid}`, String(status), 3600)
}

const getUserPresence = async (userId) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(userId)
    if (!uid) return null
    try {
        const v = await redisService.redisGet(`${PRESENCE_KEY_PREFIX}${uid}`)
        return v ? String(v) : null
    } catch (e) {
        return null
    }
}

const deleteUserPresence = async (userId) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(userId)
    if (!uid) return
    await redisService.redisDel(`${PRESENCE_KEY_PREFIX}${uid}`)
}

/** `redisSet` JSON-stringifies values; `mGet` returns raw strings — parse like `redisGet` or `p === 'online'` never matches. */
const parsePresenceMgetCell = (raw) => {
    if (raw == null || raw === '') return ''
    try {
        return String(JSON.parse(raw)).toLowerCase()
    } catch {
        return String(raw).toLowerCase()
    }
}

const DISABLE_GLOBAL_ONLINE_BROADCAST =
    (process.env.DISABLE_GLOBAL_ONLINE_BROADCAST || '').toString().toLowerCase() === 'true'

const normalizeUserId = (id) => {
    if (!id) return null
    const s = typeof id === 'string' ? id : (id.toString ? id.toString() : String(id))
    const trimmed = s.trim()
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null
    return trimmed
}

/** Same account, multiple tabs: used e.g. Football unfollow → postDeleted to all of this user’s sockets. */
const USER_SELF_ROOM_PREFIX = 'userSelf:'
export const getUserSelfRoomId = (userId) => {
    const uid = normalizeUserId(userId)
    return uid ? `${USER_SELF_ROOM_PREFIX}${uid}` : null
}

const uniqueUserIds = (ids) => {
    const out = []
    const seen = new Set()
    for (const raw of Array.isArray(ids) ? ids : []) {
        const id = normalizeUserId(raw)
        if (!id) continue
        if (seen.has(id)) continue
        seen.add(id)
        out.push(id)
    }
    return out
}

const safeClearTimer = (timerMap, key) => {
    if (!key || !timerMap?.has(key)) return
    clearTimeout(timerMap.get(key))
    timerMap.delete(key)
}

const directCallTimerKey = ({ roomName, callerId, receiverId }) => {
    const room = typeof roomName === 'string' ? roomName.trim() : ''
    if (room) return `room:${room}`
    const a = normalizeUserId(callerId)
    const b = normalizeUserId(receiverId)
    if (a && b) return `pair:${[a, b].sort().join(':')}`
    return null
}

const groupCallTimerKey = ({ roomName, conversationId }) => {
    const room = typeof roomName === 'string' ? roomName.trim() : ''
    if (room) return `room:${room}`
    const conv = normalizeUserId(conversationId)
    return conv ? `conversation:${conv}` : null
}

// ============================================================
// Scale optimizations (backward-compatible)
// - socketUser:<socketId> -> userId (O(1) disconnect mapping)
// - inCall:<userId> -> { callId, at } (O(1) busy checks)
// These keys are additive; existing scan-based behavior remains as fallback.
// ============================================================
const SOCKET_USER_PREFIX = 'socketUser:'
const IN_CALL_PREFIX = 'inCall:'

const setSocketUser = async (socketId, userId) => {
    redisService.ensureRedis()
    const sid = typeof socketId === 'string' ? socketId : (socketId?.toString?.() ?? null)
    const uid = normalizeUserId(userId)
    if (!sid || !uid) return
    await redisService.redisSet(`${SOCKET_USER_PREFIX}${sid}`, uid, 3600)
}

const getSocketUser = async (socketId) => {
    redisService.ensureRedis()
    const sid = typeof socketId === 'string' ? socketId : (socketId?.toString?.() ?? null)
    if (!sid) return null
    try {
        return await redisService.redisGet(`${SOCKET_USER_PREFIX}${sid}`)
    } catch (e) {
        console.error('❌ [socket] Failed to read socketUser mapping:', e.message)
        return null
    }
}

const deleteSocketUser = async (socketId) => {
    redisService.ensureRedis()
    const sid = typeof socketId === 'string' ? socketId : (socketId?.toString?.() ?? null)
    if (!sid) return
    await redisService.redisDel(`${SOCKET_USER_PREFIX}${sid}`)
}

const setInCall = async (userId, callId) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(userId)
    if (!uid) return
    await redisService.redisSet(`${IN_CALL_PREFIX}${uid}`, { callId: callId || null, at: Date.now() }, 3600)
}

const clearInCall = async (userId) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(userId)
    if (!uid) return
    await redisService.redisDel(`${IN_CALL_PREFIX}${uid}`)
}

/** Returns { callId, at } or null. Used for disconnect cleanup (O(1) to find other peer). */
const getInCall = async (userId) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(userId)
    if (!uid) return null
    try {
        return await redisService.redisGet(`${IN_CALL_PREFIX}${uid}`)
    } catch (e) {
        console.error('❌ [socket] getInCall failed:', e.message)
        return null
    }
}

const isInCallFast = async (userId) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(userId)
    if (!uid) return false
    try {
        const v = await redisService.redisGet(`${IN_CALL_PREFIX}${uid}`)
        return !!v
    } catch (e) {
        console.error('❌ [socket] Failed to read inCall key:', e.message)
        return false
    }
}

/** Busy / "in a call" for UI + gating: same Redis keys as `setInCall` / `clearInCall` (`inCall:<userId>`).
 *  Do NOT infer busy from `activeCall:*` alone — those rows can be orphaned if cleanup races; `inCall` is authoritative. */
const getBusyUserIdsFromInCallKeys = async () => {
    redisService.ensureRedis()
    const busy = new Set()
    try {
        const client = redisService.getRedis()
        let cursor = '0'
        let scanCount = 0
        const maxIterations = 200
        const match = `${IN_CALL_PREFIX}*`
        do {
            scanCount++
            if (scanCount > maxIterations) {
                console.error('❌ [getBusyUserIdsFromInCallKeys] Max iterations reached')
                break
            }
            const result = await client.scan(cursor, { MATCH: match, COUNT: 500 })
            let nextCursor
            let keys
            if (Array.isArray(result)) {
                nextCursor = result[0]
                keys = result[1] || []
            } else if (result && typeof result === 'object') {
                nextCursor = result.cursor
                keys = result.keys || []
            } else {
                break
            }
            cursor = nextCursor.toString()
            for (const key of keys || []) {
                const s = String(key)
                if (!s.startsWith(IN_CALL_PREFIX)) continue
                const uid = normalizeUserId(s.slice(IN_CALL_PREFIX.length))
                if (uid) busy.add(uid)
            }
        } while (cursor !== '0')
    } catch (e) {
        console.error('❌ [getBusyUserIdsFromInCallKeys]', e.message)
    }
    return busy
}

// Brief socket drops during incoming ring / WebRTC setup should not wipe call state (same idea as chess disconnect grace).
const CALL_DISCONNECT_GRACE_MS = 10000
const callDisconnectGraceTimers = new Map()

const clearCallDisconnectGraceTimer = (userId) => {
    const uid = normalizeUserId(userId)
    if (!uid) return
    const t = callDisconnectGraceTimers.get(uid)
    if (t) {
        clearTimeout(t)
        callDisconnectGraceTimers.delete(uid)
    }
}

/** callId format `${callerId}-${receiverId}`; Mongo ObjectIds contain no '-'. */
const getPeerUserIdFromCompositeCallId = (callId, uid) => {
    if (!callId || !uid) return null
    const u = normalizeUserId(uid)
    if (!u) return null
    const hyphen = callId.indexOf('-')
    if (hyphen <= 0 || hyphen >= callId.length - 1) return null
    const id1 = callId.slice(0, hyphen)
    const id2 = callId.slice(hyphen + 1)
    if (id1 === u) return id2
    if (id2 === u) return id1
    return null
}

/** Best practice: single place for firm call cleanup (scale-ready, WhatsApp-like).
 *  Clears Redis inCall + activeCall + pendingCall for both users. Call on every end/cancel/disconnect. */
const clearCallStateForPair = async (userA, userB) => {
    if (!userA || !userB) return
    const a = normalizeUserId(userA)
    const b = normalizeUserId(userB)
    if (!a || !b) return
    const callId1 = `${a}-${b}`
    const callId2 = `${b}-${a}`
    await Promise.all([
        redisService.redisDel(`activeCall:${callId1}`),
        redisService.redisDel(`activeCall:${callId2}`),
        redisService.redisDel(`pendingCall:${a}`),
        redisService.redisDel(`pendingCall:${b}`),
        redisService.redisDel(`${PENDING_ANSWER_PREFIX}${a}`),
        redisService.redisDel(`${PENDING_ANSWER_PREFIX}${b}`),
        redisService.redisDel(`${IN_CALL_PREFIX}${a}`),
        redisService.redisDel(`${IN_CALL_PREFIX}${b}`),
    ].map(p => p.catch(() => {})))
    User.findByIdAndUpdate(a, { inCall: false }).catch(() => {})
    User.findByIdAndUpdate(b, { inCall: false }).catch(() => {})
    clearCallDisconnectGraceTimer(a)
    clearCallDisconnectGraceTimer(b)
}

// Debug: Log inCall Redis values (for callback flow troubleshooting)
const logInCallStatus = async (label, userIdA, userIdB) => {
    if (!redisService.isRedisAvailable()) return
    try {
        const a = await redisService.redisGet(`${IN_CALL_PREFIX}${String(userIdA || '').trim()}`)
        const b = await redisService.redisGet(`${IN_CALL_PREFIX}${String(userIdB || '').trim()}`)
        console.log(`📴 [inCall] ${label}`, { userA: !!a, userB: !!b, userAVal: a, userBVal: b })
    } catch (e) {
        console.error('❌ [inCall] logInCallStatus failed:', e.message)
    }
}

const getOnlineSnapshotForUserIds = async (userIds) => {
    redisService.ensureRedis()
    const client = redisService.getRedis()
    const ids = uniqueUserIds(userIds)
    if (ids.length === 0) return []

    // We store socketData at `userSocket:<userId>` as JSON
    const keys = ids.map((id) => `userSocket:${id}`)
    const values = await client.mGet(keys)
    const presenceKeys = ids.map((id) => `${PRESENCE_KEY_PREFIX}${id}`)
    const presenceValues = await client.mGet(presenceKeys)

    // Has socket + clientPresence is not `offline` (parsed from JSON — see parsePresenceMgetCell).
    const online = []
    for (let i = 0; i < ids.length; i++) {
        const v = values?.[i]
        const p = parsePresenceMgetCell(presenceValues?.[i])
        if (v && p !== 'offline') {
            online.push({ userId: ids[i] })
        }
    }
    return online
}

/**
 * userIds with a socket row that are not explicitly `offline` in Redis (mGet cells JSON-parsed).
 */
const filterOutPresenceOfflineUserIds = async (userIds) => {
    const ids = uniqueUserIds(userIds)
    if (ids.length === 0) return new Set()
    redisService.ensureRedis()
    const client = redisService.getRedis()
    const presenceKeys = ids.map((id) => `${PRESENCE_KEY_PREFIX}${id}`)
    const presenceValues = await client.mGet(presenceKeys)
    const keep = new Set()
    for (let i = 0; i < ids.length; i++) {
        const p = parsePresenceMgetCell(presenceValues?.[i])
        if (p !== 'offline') keep.add(ids[i])
    }
    return keep
}

// Helper functions for userSocketMap - Redis only (required for 1M+ users)
const setUserSocket = async (userId, socketData) => {
    redisService.ensureRedis() // Redis is required
    
    try {
        // Write to Redis (primary storage for scaling)
        const success = await redisService.redisSet(`userSocket:${userId}`, socketData, 3600) // 1 hour TTL
        if (!success) {
            console.error(`❌ [socket] Failed to write user socket to Redis for ${userId}`)
        } else {
            console.log(`✅ [socket] User socket written to Redis for ${userId}`)
        }
        
        // Also keep in-memory for fast local access (but Redis is source of truth)
        userSocketMap[userId] = socketData
    } catch (error) {
        console.error(`❌ [socket] Error setting user socket for ${userId}:`, error.message)
        // Still update in-memory as fallback
        userSocketMap[userId] = socketData
    }
}

const getUserSocket = async (userId) => {
    redisService.ensureRedis() // Redis is required
    
    // Try Redis first (source of truth)
    try {
        const redisData = await redisService.redisGet(`userSocket:${userId}`)
        if (redisData) {
            // Update in-memory cache for fast access
            userSocketMap[userId] = redisData
            return redisData
        }
    } catch (error) {
        console.error(`❌ [socket] Failed to read from Redis for user ${userId}:`, error.message)
        throw error
    }
    
    // If not in Redis, check in-memory cache (shouldn't happen, but safe)
    return userSocketMap[userId] || null
}

const isUserEffectivelyOnline = async (userId) => {
    const uid = normalizeUserId(userId) || userId
    if (!uid) return false
    const sock = await getUserSocket(uid)
    if (!sock?.socketId) return false
    const presence = await getUserPresence(uid)
    if (presence && String(presence).toLowerCase() === 'offline') return false
    return true
}

/**
 * Redis userSocket entry is still connected on this Socket.IO server (or cluster via fetchSockets).
 * Does NOT use clientPresence — see `callUser`, which combines this with `getUserPresence` so
 * backgrounded users (presence offline, socket still open briefly) get FCM + pendingCall like truly offline.
 */
const resolveLiveSocketIdForUser = async (userId) => {
    const uid = normalizeUserId(userId) || userId
    if (!uid || !io) return null
    const userData = await getUserSocket(uid)
    const socketId = userData?.socketId
    if (!socketId) return null
    const isLocalLive = !!io.sockets?.sockets?.get?.(socketId)
    if (isLocalLive) return socketId
    try {
        const remotes = await io.in(socketId).fetchSockets()
        if (Array.isArray(remotes) && remotes.length > 0) return socketId
    } catch (_) {
        /* ignore */
    }
    return null
}

const deleteUserSocket = async (userId) => {
    redisService.ensureRedis() // Redis is required
    
    // Delete from Redis (primary storage)
    await redisService.redisDel(`userSocket:${userId}`)
    
    // Delete from in-memory cache
    delete userSocketMap[userId]
}

const getAllUserSockets = async () => {
    redisService.ensureRedis() // Redis is required
    
    try {
        // Get all user socket keys from Redis using SCAN (efficient for large datasets)
        const client = redisService.getRedis()
        const allSockets = {}
        let cursor = '0'
        let scanCount = 0
        const maxIterations = 100 // Prevent infinite loops
        
        do {
            scanCount++
            if (scanCount > maxIterations) {
                console.error('❌ [getAllUserSockets] Max iterations reached, breaking loop')
                break
            }
            
            try {
                const result = await client.scan(cursor, {
                    MATCH: 'userSocket:*',
                    COUNT: 100 // Process 100 keys at a time
                })
                
                // Redis client v4+ returns [nextCursor, keys] array format
                // Redis client v3 returns {cursor, keys} object format
                let nextCursor, keys
                if (Array.isArray(result)) {
                    // v4+ format: [cursor, keys]
                    nextCursor = result[0]
                    keys = result[1] || []
                } else if (result && typeof result === 'object') {
                    // v3 format: {cursor, keys}
                    nextCursor = result.cursor
                    keys = result.keys || []
                } else {
                    console.error('❌ [getAllUserSockets] Unexpected SCAN result format:', result)
                    break
                }
                
                cursor = nextCursor.toString()
                
                // Fetch all values for these keys
                if (keys && keys.length > 0) {
                    const values = await client.mGet(keys)
                    keys.forEach((key, index) => {
                        if (values[index]) {
                            try {
                                const userId = key.replace('userSocket:', '')
                                const socketData = JSON.parse(values[index])
                                allSockets[userId] = socketData
                            } catch (e) {
                                console.error(`❌ Failed to parse socket data for ${key}:`, e)
                            }
                        }
                    })
                }
            } catch (scanError) {
                console.error('❌ [getAllUserSockets] SCAN error:', scanError.message)
                break
            }
        } while (cursor !== '0')
        
        // Update in-memory cache for fast local access
        Object.assign(userSocketMap, allSockets)
        
        return allSockets
    } catch (error) {
        console.error('❌ [getAllUserSockets] Failed to get all user sockets from Redis:', error.message)
        // Fallback to in-memory cache
        return userSocketMap
    }
}

// Helper functions for chessGameStates - Redis only
const setChessGameState = async (roomId, gameState) => {
    redisService.ensureRedis()
    await redisService.redisSet(`chessGameState:${roomId}`, gameState, 7200) // 2 hour TTL
    chessGameStates.set(roomId, gameState) // Keep in-memory cache
}

const getChessGameState = async (roomId) => {
    redisService.ensureRedis()
    try {
        const redisData = await redisService.redisGet(`chessGameState:${roomId}`)
        if (redisData) {
            chessGameStates.set(roomId, redisData) // Update cache
            return redisData
        }
    } catch (error) {
        console.error(`❌ [socket] Failed to read chess game state from Redis for ${roomId}:`, error.message)
        throw error
    }
    return chessGameStates.get(roomId) || null
}

const deleteChessGameState = async (roomId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`chessGameState:${roomId}`)
    chessGameStates.delete(roomId)
}

// Helper functions for activeChessGames - Redis only
const setActiveChessGame = async (userId, roomId) => {
    redisService.ensureRedis()
    await redisService.redisSet(`activeChessGame:${userId}`, roomId, 7200) // 2 hour TTL
    activeChessGames.set(userId, roomId) // Keep in-memory cache
}

const getActiveChessGame = async (userId) => {
    redisService.ensureRedis()
    try {
        const redisData = await redisService.redisGet(`activeChessGame:${userId}`)
        if (redisData) {
            activeChessGames.set(userId, redisData) // Update cache
            return redisData
        }
    } catch (error) {
        console.error(`❌ [socket] Failed to read active chess game from Redis for ${userId}:`, error.message)
        throw error
    }
    return activeChessGames.get(userId) || null
}

const deleteActiveChessGame = async (userId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`activeChessGame:${userId}`)
    activeChessGames.delete(userId)
}

const hasActiveChessGame = async (userId) => {
    redisService.ensureRedis()
    const roomId = await getActiveChessGame(userId)
    return roomId !== null
}

// Challenger (or accepter) may not be in userSocketMap yet when the other accepts — e.g. fresh Google login
// + slow socket connect. Queue acceptChessChallenge payload and deliver on next connection.
const PENDING_CHESS_ACCEPT_PREFIX = 'pendingChessAccept:'
const PENDING_CHESS_ACCEPT_TTL = 120

const setPendingChessAcceptForUser = async (userId, payload) => {
    redisService.ensureRedis()
    const id = normalizeUserId(userId) || userId
    if (!id) return
    await redisService.redisSet(
        `${PENDING_CHESS_ACCEPT_PREFIX}${id}`,
        payload,
        PENDING_CHESS_ACCEPT_TTL
    )
}

/** Returns and deletes pending payload (one-shot). */
const takePendingChessAcceptForUser = async (userId) => {
    redisService.ensureRedis()
    const id = normalizeUserId(userId) || userId
    if (!id) return null
    const key = `${PENDING_CHESS_ACCEPT_PREFIX}${id}`
    const data = await redisService.redisGet(key)
    if (data) await redisService.redisDel(key)
    return data
}

const deletePendingChessAcceptForUser = async (userId) => {
    redisService.ensureRedis()
    const id = normalizeUserId(userId) || userId
    if (!id) return
    await redisService.redisDel(`${PENDING_CHESS_ACCEPT_PREFIX}${id}`)
}

/** Pending accept must match an active game + Redis state, or it is stale (game ended / canceled). */
const isPendingChessAcceptStillValid = async (userId, payload) => {
    if (!payload?.roomId) return false
    const uid = normalizeUserId(userId) || userId
    if (!uid) return false
    try {
        const activeRoom = await getActiveChessGame(uid)
        if (!activeRoom || String(activeRoom) !== String(payload.roomId)) return false
        const state = await getChessGameState(payload.roomId)
        return !!state
    } catch (_) {
        return false
    }
}

const PENDING_CARD_ACCEPT_PREFIX = 'pendingCardAccept:'
const PENDING_CARD_ACCEPT_TTL = 120

const setPendingCardAcceptForUser = async (userId, payload) => {
    redisService.ensureRedis()
    const id = normalizeUserId(userId) || userId
    if (!id) return
    await redisService.redisSet(
        `${PENDING_CARD_ACCEPT_PREFIX}${id}`,
        payload,
        PENDING_CARD_ACCEPT_TTL
    )
}

/** Returns and deletes pending payload (one-shot). */
const takePendingCardAcceptForUser = async (userId) => {
    redisService.ensureRedis()
    const id = normalizeUserId(userId) || userId
    if (!id) return null
    const key = `${PENDING_CARD_ACCEPT_PREFIX}${id}`
    const data = await redisService.redisGet(key)
    if (data) await redisService.redisDel(key)
    return data
}

const deletePendingCardAcceptForUser = async (userId) => {
    redisService.ensureRedis()
    const id = normalizeUserId(userId) || userId
    if (!id) return
    await redisService.redisDel(`${PENDING_CARD_ACCEPT_PREFIX}${id}`)
}

const isPendingCardAcceptStillValid = async (userId, payload) => {
    if (!payload?.roomId) return false
    const uid = normalizeUserId(userId) || userId
    if (!uid) return false
    try {
        const activeRoom = await getActiveCardGame(uid)
        if (!activeRoom || String(activeRoom) !== String(payload.roomId)) return false
        const state = await getCardGameState(payload.roomId)
        return !!state
    } catch (_) {
        return false
    }
}

// Helper functions for cardGameStates - Redis only
const setCardGameState = async (roomId, gameState) => {
    redisService.ensureRedis()
    await redisService.redisSet(`cardGameState:${roomId}`, gameState, 7200) // 2 hour TTL
}

const getCardGameState = async (roomId) => {
    redisService.ensureRedis()
    try {
        const redisData = await redisService.redisGet(`cardGameState:${roomId}`)
        if (redisData) {
            return redisData
        }
    } catch (error) {
        console.error(`❌ [socket] Failed to read card game state from Redis for ${roomId}:`, error.message)
        throw error
    }
    return null
}

/** Personalized cardGameState payload for one viewer (full hand for self, counts for opponent). */
const buildCardGameStatePayloadForViewer = (gameState, roomId, viewerUserId) => {
    const vid = (normalizeUserId(viewerUserId) || viewerUserId)?.toString()
    const viewerPlayerIndex = gameState.players.findIndex((p) => {
        const pId = (normalizeUserId(p.userId) || p.userId)?.toString()
        return pId === vid
    })
    return {
        roomId,
        players: gameState.players.map((p, index) => {
            if (index === viewerPlayerIndex && viewerPlayerIndex >= 0) {
                return {
                    userId: p.userId,
                    hand: p.hand || [],
                    score: p.score,
                    books: p.books || [],
                }
            }
            return {
                userId: p.userId,
                handCount: p.hand?.length || 0,
                score: p.score,
                books: p.books || [],
            }
        }),
        deckCount: gameState.deck?.length || 0,
        table: gameState.table,
        turn: gameState.turn,
        gameStatus: gameState.gameStatus,
        winner: gameState.winner,
        lastMove: gameState.lastMove,
    }
}

const deleteCardGameState = async (roomId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`cardGameState:${roomId}`)
}

// Helper functions for activeCardGames - Redis only
const setActiveCardGame = async (userId, roomId) => {
    redisService.ensureRedis()
    await redisService.redisSet(`activeCardGame:${userId}`, roomId, 7200) // 2 hour TTL
}

const getActiveCardGame = async (userId) => {
    redisService.ensureRedis()
    try {
        const redisData = await redisService.redisGet(`activeCardGame:${userId}`)
        if (redisData) {
            return redisData
        }
    } catch (error) {
        console.error(`❌ [socket] Failed to read active card game from Redis for ${userId}:`, error.message)
        throw error
    }
    return null
}

const deleteActiveCardGame = async (userId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`activeCardGame:${userId}`)
}

const hasActiveCardGame = async (userId) => {
    redisService.ensureRedis()
    const roomId = await getActiveCardGame(userId)
    return roomId !== null
}

// ── 🏎️ Racing Game Redis helpers ──────────────────────────────────────────────
const setActiveRaceGame = async (userId, roomId) => {
    redisService.ensureRedis()
    await redisService.redisSet(`activeRaceGame:${userId}`, roomId, 3600)
}
const getActiveRaceGame = async (userId) => {
    redisService.ensureRedis()
    try {
        const v = await redisService.redisGet(`activeRaceGame:${userId}`)
        return v || null
    } catch (e) {
        console.error(`❌ [racing] getActiveRaceGame ${userId}:`, e.message)
        return null
    }
}
const deleteActiveRaceGame = async (userId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`activeRaceGame:${userId}`)
}
const hasActiveRaceGame = async (userId) => {
    redisService.ensureRedis()
    const r = await getActiveRaceGame(userId)
    return r !== null
}
const setRaceGameState = async (roomId, state) => {
    redisService.ensureRedis()
    await redisService.redisSet(`raceGameState:${roomId}`, state, 3600)
}
const getRaceGameState = async (roomId) => {
    redisService.ensureRedis()
    try {
        return await redisService.redisGet(`raceGameState:${roomId}`)
    } catch (e) {
        return null
    }
}
const deleteRaceGameState = async (roomId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`raceGameState:${roomId}`)
}

// Helper functions for activeCalls - Redis only
const setActiveCall = async (callId, callData) => {
    redisService.ensureRedis()
    await redisService.redisSet(`activeCall:${callId}`, callData, 3600) // 1 hour TTL
}

const getActiveCall = async (callId) => {
    redisService.ensureRedis()
    try {
        return await redisService.redisGet(`activeCall:${callId}`)
    } catch (error) {
        console.error(`❌ [socket] Failed to read active call from Redis for ${callId}:`, error.message)
        return null
    }
}

const deleteActiveCall = async (callId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`activeCall:${callId}`)
}

// Dedupe cancelCall to avoid double FCM + double CallCanceled when both sides cancel
const cancelProcessedKeys = new Set()
const CANCEL_DEDUPE_TTL_MS = 6000

// Helper functions for pending calls (indexed by receiverId for O(1) lookup)
// This is more scalable than SCAN for 1M+ users
const setPendingCall = async (receiverId, callData) => {
    redisService.ensureRedis()
    // Short TTL: ringing window. Prevent stale calls after long offline.
    await redisService.redisSet(`pendingCall:${receiverId}`, callData, 75) // 75 seconds TTL
}

const getPendingCall = async (receiverId) => {
    redisService.ensureRedis()
    try {
        return await redisService.redisGet(`pendingCall:${receiverId}`)
    } catch (error) {
        console.error(`❌ [socket] Failed to read pending call from Redis for ${receiverId}:`, error.message)
        return null
    }
}

const deletePendingCall = async (receiverId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`pendingCall:${receiverId}`)
}

// Queue ICE candidates when receiver is offline; deliver when they connect (requestCallSignal)
const PENDING_ICE_PREFIX = 'pendingIce:'
const PENDING_ICE_MAX = 40
const PENDING_ICE_TTL = 300 // 5 min

const appendPendingIce = async (receiverId, { from, candidate, callId }) => {
    redisService.ensureRedis()
    try {
        const key = `${PENDING_ICE_PREFIX}${receiverId}`
        const raw = await redisService.redisGet(key)
        const list = raw ? (Array.isArray(raw) ? raw : [raw]) : []
        list.push({ from, candidate, callId })
        const trimmed = list.slice(-PENDING_ICE_MAX)
        await redisService.redisSet(key, trimmed, PENDING_ICE_TTL)
    } catch (e) {
        console.error('❌ [pendingIce] append failed:', e?.message)
    }
}

const getAndClearPendingIce = async (receiverId) => {
    redisService.ensureRedis()
    try {
        const key = `${PENDING_ICE_PREFIX}${receiverId}`
        const raw = await redisService.redisGet(key)
        await redisService.redisDel(key)
        if (!raw) return []
        return Array.isArray(raw) ? raw : [raw]
    } catch (e) {
        console.error('❌ [pendingIce] getAndClear failed:', e?.message)
        return []
    }
}

const PENDING_ANSWER_TTL = 120

const setPendingAnswer = async (callerId, payload) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(callerId)
    if (!uid) return
    try {
        await redisService.redisSet(`${PENDING_ANSWER_PREFIX}${uid}`, payload, PENDING_ANSWER_TTL)
    } catch (e) {
        console.error('❌ [pendingAnswer] set failed:', e?.message)
    }
}

const getAndClearPendingAnswer = async (callerId) => {
    redisService.ensureRedis()
    const uid = normalizeUserId(callerId)
    if (!uid) return null
    const key = `${PENDING_ANSWER_PREFIX}${uid}`
    try {
        const raw = await redisService.redisGet(key)
        await redisService.redisDel(key)
        return raw || null
    } catch (e) {
        console.error('❌ [pendingAnswer] getAndClear failed:', e?.message)
        return null
    }
}

// Helper functions for pending cancels (when receiver was offline/backgrounded)
// This is critical for WhatsApp-like UX: if caller cancels while receiver socket is disconnected,
// receiver must clear ringing UI immediately after reconnect.
const setPendingCancel = async (receiverId, cancelData) => {
    redisService.ensureRedis()
    // Short TTL: if user doesn't come back soon, it's not relevant.
    await redisService.redisSet(`pendingCancel:${receiverId}`, cancelData, 180) // 3 minutes TTL
}

const getPendingCancel = async (receiverId) => {
    redisService.ensureRedis()
    try {
        return await redisService.redisGet(`pendingCancel:${receiverId}`)
    } catch (error) {
        console.error(`❌ [socket] Failed to read pending cancel from Redis for ${receiverId}:`, error.message)
        return null
    }
}

const deletePendingCancel = async (receiverId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`pendingCancel:${receiverId}`)
}

const getAllActiveCalls = async () => {
    redisService.ensureRedis()
    try {
        const client = redisService.getRedis()
        const allCalls = {}
        let cursor = '0'
        let scanCount = 0
        const maxIterations = 100
        
        do {
            scanCount++
            if (scanCount > maxIterations) {
                console.error('❌ [getAllActiveCalls] Max iterations reached, breaking loop')
                break
            }
            
            const result = await client.scan(cursor, {
                MATCH: 'activeCall:*',
                COUNT: 100
            })
            
            // Handle both array [cursor, keys] and object {cursor, keys} formats
            let nextCursor, keys
            if (Array.isArray(result)) {
                nextCursor = result[0]
                keys = result[1] || []
            } else if (result && typeof result === 'object') {
                nextCursor = result.cursor
                keys = result.keys || []
            } else {
                break
            }
            
            cursor = nextCursor.toString()
            
            if (keys && keys.length > 0) {
                const values = await client.mGet(keys)
                keys.forEach((key, index) => {
                    if (values[index]) {
                        try {
                            const callId = key.replace('activeCall:', '')
                            allCalls[callId] = JSON.parse(values[index])
                        } catch (e) {
                            console.error(`❌ Failed to parse call data for ${key}:`, e)
                        }
                    }
                })
            }
        } while (cursor !== '0')
        
        return allCalls
    } catch (error) {
        console.error('❌ [getAllActiveCalls] Failed to get all active calls from Redis:', error.message)
        return {}
    }
}

// Helper functions for chessRooms - Redis only
const setChessRoom = async (roomId, room) => {
    redisService.ensureRedis()
    await redisService.redisSet(`chessRoom:${roomId}`, room, 7200) // 2 hour TTL
}

const getChessRoom = async (roomId) => {
    redisService.ensureRedis()
    try {
        return await redisService.redisGet(`chessRoom:${roomId}`)
    } catch (error) {
        console.error(`❌ [socket] Failed to read chess room from Redis for ${roomId}:`, error.message)
        return null
    }
}

const deleteChessRoom = async (roomId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`chessRoom:${roomId}`)
}

const getAllChessRooms = async () => {
    redisService.ensureRedis()
    try {
        const client = redisService.getRedis()
        const allRooms = {}
        let cursor = '0'
        let scanCount = 0
        const maxIterations = 100
        
        do {
            scanCount++
            if (scanCount > maxIterations) {
                console.error('❌ [getAllChessRooms] Max iterations reached, breaking loop')
                break
            }
            
            const result = await client.scan(cursor, {
                MATCH: 'chessRoom:*',
                COUNT: 100
            })
            
            // Handle both array [cursor, keys] and object {cursor, keys} formats
            let nextCursor, keys
            if (Array.isArray(result)) {
                nextCursor = result[0]
                keys = result[1] || []
            } else if (result && typeof result === 'object') {
                nextCursor = result.cursor
                keys = result.keys || []
            } else {
                break
            }
            
            cursor = nextCursor.toString()
            
            if (keys && keys.length > 0) {
                const values = await client.mGet(keys)
                keys.forEach((key, index) => {
                    if (values[index]) {
                        try {
                            const roomId = key.replace('chessRoom:', '')
                            allRooms[roomId] = JSON.parse(values[index])
                        } catch (e) {
                            console.error(`❌ Failed to parse chess room data for ${key}:`, e)
                        }
                    }
                })
            }
        } while (cursor !== '0')
        
        return allRooms
    } catch (error) {
        console.error('❌ [getAllChessRooms] Failed to get all chess rooms from Redis:', error.message)
        return {}
    }
}

export const initializeSocket = async (app) => {
    // Create HTTP server from Express app
    server = http.createServer(app)
    
    // Initialize Socket.IO
    io = new Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL || "http://localhost:5173",
            credentials: true,
            methods: ["GET", "POST"]
        }
    })

    // Set up Redis adapter for Socket.IO (REQUIRED for multi-server scaling)
    if (process.env.REDIS_URL) {
        try {
            const { createAdapter } = await import('@socket.io/redis-adapter')
            const { getRedisPubSub } = await import('../services/redis.js')
            const pubSub = getRedisPubSub()
            
            if (pubSub && pubSub.pubClient && pubSub.subClient) {
                io.adapter(createAdapter(pubSub.pubClient, pubSub.subClient))
                console.log('✅ Socket.IO Redis adapter configured - ready for multi-server scaling!')
            } else {
                console.warn('⚠️  Redis pub/sub clients not available - Socket.IO adapter not configured')
            }
        } catch (error) {
            console.error('❌ Failed to set up Socket.IO Redis adapter:', error.message)
            // Don't exit - app can work with single server, but won't scale horizontally
        }
    }

    /** All tabs for a user join `userSelf:<id>` — prefer this over a single `getUserSocket` id for feed UI events. */
    const emitToUserSelf = (userId, event, payload) => {
        const uid = normalizeUserId(userId) || (userId != null && String(userId).trim() !== '' ? String(userId).trim() : null)
        if (!uid) return
        const room = getUserSelfRoomId(uid)
        if (room) io.to(room).emit(event, payload)
    }

    /** Broadcaster refresh/kill-tab without `livekit:endLive` — clean Mongo + notify after grace; reconnect cancels. */
    const LIVE_STREAM_DISCONNECT_GRACE_MS = (() => {
        const n = Number(process.env.LIVE_STREAM_DISCONNECT_GRACE_MS || 6000)
        return Number.isFinite(n) && n >= 2000 && n <= 60000 ? n : 6000
    })()
    const liveStreamDisconnectTimers = new Map()

    io.on("connection", async (socket) => {
        console.log("user connected", socket.id)
        
        const userIdRaw = socket.handshake.query.userId
        const clientTypeRaw = socket.handshake.query.clientType
        const clientType = typeof clientTypeRaw === 'string' ? clientTypeRaw.trim().toLowerCase() : ''
        const userId = normalizeUserId(userIdRaw) || userIdRaw
        console.log("🔌 [socket] User connecting with userId:", userId, userIdRaw !== userId ? `(normalized from ${userIdRaw})` : '')
        // Presence subscription support (clients can subscribe to specific userIds)
        socket.data.presenceSubscriptions = []
        // Store socket info as object like madechess (dual-write: in-memory + Redis). Use normalized id so callUser lookup finds receiver.
        if (userId && userId !== "undefined") {
            const socketData = {
                socketId: socket.id,
                onlineAt: Date.now(),
                clientType: clientType || undefined,
            }
            // Presence before socket so mGet snapshots never see userSocket without matching `online` (avoids false offline / asymmetric status).
            await setUserPresence(userId, 'online')
            await setUserSocket(userId, socketData)
            // Reverse mapping for O(1) disconnect handling
            await setSocketUser(socket.id, userId)
            const selfRoom = getUserSelfRoomId(userId)
            if (selfRoom) {
                socket.join(selfRoom)
            }
            {
                const lsUid = normalizeUserId(userId)
                if (lsUid && liveStreamDisconnectTimers.has(lsUid)) {
                    clearTimeout(liveStreamDisconnectTimers.get(lsUid))
                    liveStreamDisconnectTimers.delete(lsUid)
                }
            }
            console.log(`✅ [socket] User ${userId} added to socket map (socket: ${socket.id})`)

            // Join all conversation rooms so group (and 1-to-1) messages are received via room broadcast.
            try {
                const { default: Conversation } = await import('../models/conversation.js')
                const convs = await Conversation.find({ participants: userId }).select('_id').lean()
                for (const c of convs) {
                    socket.join(c._id.toString())
                }
                if (convs.length) console.log(`📬 [socket] ${userId} joined ${convs.length} conversation room(s)`)
            } catch (e) {
                console.error('❌ [socket] Failed to join conversation rooms:', e.message)
            }

            // Reconnect cancels delayed call teardown scheduled on disconnect (avoids false "call ended" FCM).
            try {
                const normConn = normalizeUserId(userId)
                if (normConn) clearCallDisconnectGraceTimer(normConn)
            } catch (_) {}

            // Emit targeted presence update for this userId (for subscribed clients)
            try {
                const normalized = normalizeUserId(userId)
                if (normalized) {
                    io.to(`${PRESENCE_ROOM_PREFIX}${normalized}`).emit('presenceUpdate', {
                        userId: normalized,
                        online: true,
                        onlineAt: socketData.onlineAt,
                    })
                }
            } catch (e) {
                console.error('❌ [socket] Failed to emit presenceUpdate (online):', e.message)
            }
            
            // Do NOT send pending call here – client may not have callUser listener attached yet (race).
            // Client will emit requestCallSignal when ready; requestCallSignal handler sends the signal.

            // Deliver any pending cancel so user can clear UI and call again (caller canceled while this user was offline)
            // Delay so client has time to attach socket listeners after reconnect – otherwise CallCanceled can be missed
            try {
                const pendingCancel = await getPendingCancel(userId)
                if (pendingCancel) {
                    console.log(`📴 [socket] Found pending cancel for ${userId}, will emit CallCanceled after short delay...`, pendingCancel)
                    await deletePendingCancel(userId)
                    const sid = socket.id
                    // IMMEDIATE emit - no delay for faster cleanup
                    io.to(sid).emit("CallCanceled")
                    console.log(`✅ [socket] Emitted CallCanceled to ${userId} (pending cancel on connect, IMMEDIATE)`)
                }
            } catch (error) {
                console.error(`❌ [socket] Error checking for pending cancels when ${userId} connected:`, error.message)
            }

            // Queued chess/card accept: delay so client can attach AppNavigator listeners (same race as calls).
            const connectSid = socket.id
            const connectUserId = userId
            setTimeout(async () => {
                const sock = io.sockets.sockets.get(connectSid)
                if (!sock) return
                try {
                    const pendingChess = await takePendingChessAcceptForUser(connectUserId)
                    if (pendingChess?.roomId && pendingChess.yourColor && pendingChess.opponentId) {
                        const stillValid = await isPendingChessAcceptStillValid(connectUserId, pendingChess)
                        if (!stillValid) {
                            console.log(`♟️ [socket] Skipping stale pending chess accept for ${connectUserId} (room ${pendingChess.roomId})`)
                        } else {
                            console.log(`♟️ [socket] Delivering pending acceptChessChallenge to ${connectUserId}`, pendingChess)
                            io.to(connectSid).emit('acceptChessChallenge', {
                                roomId: pendingChess.roomId,
                                yourColor: pendingChess.yourColor,
                                opponentId: pendingChess.opponentId,
                            })
                            sock.join(pendingChess.roomId)
                        }
                    }
                } catch (e) {
                    console.error(`❌ [socket] Error delivering pending chess accept for ${connectUserId}:`, e.message)
                }
                try {
                    const pendingCard = await takePendingCardAcceptForUser(connectUserId)
                    if (pendingCard?.roomId && pendingCard.opponentId != null) {
                        const stillValid = await isPendingCardAcceptStillValid(connectUserId, pendingCard)
                        if (!stillValid) {
                            console.log(`🃏 [socket] Skipping stale pending card accept for ${connectUserId} (room ${pendingCard.roomId})`)
                        } else {
                            console.log(`🃏 [socket] Delivering pending acceptCardChallenge to ${connectUserId}`, pendingCard)
                            io.to(connectSid).emit('acceptCardChallenge', {
                                roomId: pendingCard.roomId,
                                opponentId: pendingCard.opponentId,
                            })
                            sock.join(pendingCard.roomId)
                            const gs = await getCardGameState(pendingCard.roomId)
                            if (gs) {
                                const cardPayload = buildCardGameStatePayloadForViewer(gs, pendingCard.roomId, connectUserId)
                                io.to(connectSid).emit('cardGameState', cardPayload)
                            } else {
                                console.warn(`🃏 [socket] Pending card accept for ${connectUserId} but no game state in Redis for ${pendingCard.roomId}`)
                            }
                        }
                    }
                } catch (e) {
                    console.error(`❌ [socket] Error delivering pending card accept for ${connectUserId}:`, e.message)
                }
                try {
                    const pendingAns = await getAndClearPendingAnswer(connectUserId)
                    if (pendingAns?.signal && (pendingAns.signal.sdp || pendingAns.signal.type)) {
                        const out = { signal: pendingAns.signal }
                        if (pendingAns.callId) out.callId = pendingAns.callId
                        io.to(connectSid).emit('callAccepted', out)
                        console.log(`✅ [socket] Delivered queued WebRTC answer to caller ${connectUserId} (reconnect after callee answered)`)
                    }
                } catch (e) {
                    console.error(`❌ [socket] Error delivering pending answer for ${connectUserId}:`, e.message)
                }

                // Auto-recover active race game on reconnect (mirrors pendingChessAccept pattern).
                // Fired on every connect so switching browsers or refreshing during a race
                // transparently re-joins the player to their in-progress room without needing
                // the client to request recovery explicitly.
                try {
                    const activeRaceRoom = await getActiveRaceGame(connectUserId)
                    if (activeRaceRoom) {
                        const raceState = await getRaceGameState(activeRaceRoom).catch(() => null)
                        if (raceState) {
                            const rp1 = normalizeUserId(raceState.player1) || raceState.player1
                            const rp2 = normalizeUserId(raceState.player2) || raceState.player2
                            const rIsHost = rp1 === connectUserId
                            const rOpponentId = rIsHost ? rp2 : rp1
                            const sockNow = io.sockets.sockets.get(connectSid)
                            if (sockNow) {
                                sockNow.join(activeRaceRoom)
                                io.to(connectSid).emit('raceGameRecovery', {
                                    ok: true,
                                    roomId: activeRaceRoom,
                                    opponentId: rOpponentId,
                                    isHost: rIsHost,
                                })
                                console.log(`🏎️ [socket] Auto-delivered race recovery to ${connectUserId} for room ${activeRaceRoom}`)
                            }
                        }
                    }
                } catch (e) {
                    console.error(`❌ [socket] Error auto-recovering race for ${connectUserId}:`, e.message)
                }

                // Auto-recover active card game on reconnect (mirrors pendingChessAccept pattern).
                // pendingCardAccept was already consumed above; if activeCardGame still exists
                // then this is a reconnect to an ongoing game — re-deliver state so the Card
                // page can rejoin the room without the user having to manually request recovery.
                try {
                    const activeCardRoom = await getActiveCardGame(connectUserId)
                    if (activeCardRoom) {
                        const cardState = await getCardGameState(activeCardRoom).catch(() => null)
                        if (cardState) {
                            const cp1 = normalizeUserId(cardState.player1 || cardState.players?.[0]?.id)
                            const cp2 = normalizeUserId(cardState.player2 || cardState.players?.[1]?.id)
                            const cOpponentId = cp1 === connectUserId ? cp2 : cp1
                            const sockNow = io.sockets.sockets.get(connectSid)
                            if (sockNow) {
                                sockNow.join(activeCardRoom)
                                const cardPayload = buildCardGameStatePayloadForViewer(cardState, activeCardRoom, connectUserId)
                                io.to(connectSid).emit('cardGameRecovery', {
                                    ok: true,
                                    roomId: activeCardRoom,
                                    opponentId: cOpponentId,
                                })
                                io.to(connectSid).emit('cardGameState', cardPayload)
                                console.log(`🃏 [socket] Auto-delivered card recovery to ${connectUserId} for room ${activeCardRoom}`)
                            }
                        }
                    }
                } catch (e) {
                    console.error(`❌ [socket] Error auto-recovering card for ${connectUserId}:`, e.message)
                }
            }, 450)
        } else {
            console.warn("⚠️ [socket] User connected without valid userId:", userId)
        }

        // New: allow clients to subscribe to presence updates for a subset of users
        // Payload: { userIds: string[] }
        socket.on('presenceSubscribe', async (payload = {}) => {
            try {
                const requested = uniqueUserIds(payload.userIds || [])

                // Leave previous rooms first to avoid unbounded growth on re-subscribe
                const prev = Array.isArray(socket.data.presenceSubscriptions)
                    ? socket.data.presenceSubscriptions
                    : []
                for (const prevId of prev) {
                    socket.leave(`${PRESENCE_ROOM_PREFIX}${prevId}`)
                }

                // Join new rooms
                for (const id of requested) {
                    socket.join(`${PRESENCE_ROOM_PREFIX}${id}`)
                }
                socket.data.presenceSubscriptions = requested

                // Snapshot: who is online among subscribed ids + full id list so clients set explicit offline
                // (avoids "partner looks online" from global list while socket still open during app background).
                const snapshot = await getOnlineSnapshotForUserIds(requested)
                socket.emit('presenceSnapshot', { onlineUsers: snapshot, subscribedUserIds: requested })
            } catch (e) {
                console.error('❌ [socket] presenceSubscribe error:', e.message)
            }
        })

        // Client-controlled presence (foreground/background) without requiring socket disconnect.
        // Payload: { status: 'online' | 'offline' }
        socket.on('clientPresence', async (payload = {}) => {
            try {
                const statusRaw = (payload?.status || '').toString().toLowerCase()
                const status = statusRaw === 'offline' ? 'offline' : 'online'
                const uid = normalizeUserId(userId)
                if (!uid) return
                await setUserPresence(uid, status)
                io.to(`${PRESENCE_ROOM_PREFIX}${uid}`).emit('presenceUpdate', {
                    userId: uid,
                    online: status === 'online',
                    onlineAt: status === 'online' ? Date.now() : undefined,
                })
            } catch (e) {
                console.error('❌ [socket] clientPresence error:', e?.message || e)
            }
        })
        
        // Emit online users to ALL clients after ANY connection (with or without userId)
        // Use debouncing to prevent infinite loops - only emit once every 500ms
        // NOTE: In production at scale, disable this with DISABLE_GLOBAL_ONLINE_BROADCAST=true
        if (!DISABLE_GLOBAL_ONLINE_BROADCAST) {
            if (emitOnlineUsersTimeout) {
                clearTimeout(emitOnlineUsersTimeout)
            }
            
            emitOnlineUsersTimeout = setTimeout(async () => {
            // Prevent concurrent emissions
            if (isEmittingOnlineUsers) {
                console.log('⚠️ [socket] Already emitting online users, skipping...')
                return
            }
            
            isEmittingOnlineUsers = true
            
            try {
                // Small delay to ensure Redis has the data before fetching
                await new Promise(resolve => setTimeout(resolve, 100))
                
                // Get all sockets from Redis (source of truth) with timeout
                const allSocketsPromise = getAllUserSockets()
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('getAllUserSockets timeout after 3s')), 3000)
                )
                
                const allSockets = await Promise.race([allSocketsPromise, timeoutPromise])
                const socketCount = Object.keys(allSockets).length
                
                if (socketCount === 0) {
                    // Use in-memory as fallback if Redis is empty
                    const busyUserIds = await getBusyUserIdsFromInCallKeys()
                    
                    const memEntries = Object.entries(userSocketMap)
                    const keepPresence = await filterOutPresenceOfflineUserIds(memEntries.map(([id]) => id))
                    const fallbackArray = memEntries
                        .filter(([id]) => keepPresence.has(id))
                        .map(([id, data]) => ({
                            userId: id,
                            onlineAt: data.onlineAt,
                            inCall: busyUserIds.has(id), // Fast Set lookup
                        }))
                    if (fallbackArray.length > 0) {
                        io.emit("getOnlineUser", fallbackArray)
                        isEmittingOnlineUsers = false
                        return
                    }
                }
                
                // Emit online users as array of objects like madechess
                // Busy = users with Redis `inCall:<id>` (same source as `isUserBusy`)
                const busyUserIds = await getBusyUserIdsFromInCallKeys()
                
                // Map online users; respect clientPresence offline (socket may still exist during delayed disconnect)
                const sockEntries = Object.entries(allSockets)
                const keepPresenceMain = await filterOutPresenceOfflineUserIds(sockEntries.map(([id]) => id))
                const onlineArray = sockEntries
                    .filter(([id]) => keepPresenceMain.has(id))
                    .map(([id, data]) => ({
                        userId: id,
                        onlineAt: data.onlineAt,
                        inCall: busyUserIds.has(id), // Fast Set lookup, no database query
                    }))
                if (onlineArray.length > 0) {
                    io.emit("getOnlineUser", onlineArray)
                }
            } catch (error) {
                console.error('❌ [socket] Error emitting getOnlineUser:', error.message)
                // Fallback: emit from in-memory cache
                // OPTIMIZED: Get busy users from Redis (active calls) instead of database
                try {
                    const busyUserIds = await getBusyUserIdsFromInCallKeys()
                    
                    const memEntries2 = Object.entries(userSocketMap)
                    const keepPresenceFb = await filterOutPresenceOfflineUserIds(memEntries2.map(([id]) => id))
                    const fallbackArray = memEntries2
                        .filter(([id]) => keepPresenceFb.has(id))
                        .map(([id, data]) => ({
                            userId: id,
                            onlineAt: data.onlineAt,
                            inCall: busyUserIds.has(id), // Fast Set lookup
                        }))
                    console.log(`⚠️ [socket] Emitting from in-memory fallback with ${fallbackArray.length} users`)
                    io.emit("getOnlineUser", fallbackArray)
                } catch (fallbackError) {
                    console.error('❌ [socket] Fallback emit also failed:', fallbackError)
                }
            } finally {
                isEmittingOnlineUsers = false
            }
            }, 500) // Debounce: wait 500ms before emitting to prevent spam
        }

        // Helper: user is busy if Redis `inCall:<userId>` exists (fast path),
        // OR if MongoDB User.inCall is true (durable fallback — survives brief socket reconnects > grace period).
        // `activeCall:*` rows alone do NOT make a user busy (they can be orphaned).
        const isUserBusy = async (userId) => {
            const uid = normalizeUserId(userId)
            if (!uid) return false
            if (await isInCallFast(uid)) return true
            try {
                const u = await User.findById(uid).select('inCall').lean()
                return !!u?.inCall
            } catch {
                return false
            }
        }

        /** Block game invites while in a call or already in chess/card (server-side; app also filters). */
        const isBlockedForGameChallenge = async (userId) => {
            const uid = normalizeUserId(userId) || userId
            if (!uid) return true
            if (await isUserBusy(uid)) return true
            if (await getActiveChessGame(uid)) return true
            if (await getActiveCardGame(uid)) return true
            if (await hasActiveRaceGame(uid)) return true
            return false
        }

        /**
         * Calls policy while gaming:
         * - Block calls if either user is in chess/card.
         * - For race: allow call only when BOTH users are in the SAME race room
         *   (race opponents talking in-game). Otherwise block.
         */
        const evaluateGameCallPolicy = async (callerId, receiverId) => {
            const caller = normalizeUserId(callerId) || callerId
            const receiver = normalizeUserId(receiverId) || receiverId
            if (!caller || !receiver) return { allowed: false, reason: 'invalid_users' }

            const [callerChess, receiverChess, callerCard, receiverCard] = await Promise.all([
                hasActiveChessGame(caller),
                hasActiveChessGame(receiver),
                hasActiveCardGame(caller),
                hasActiveCardGame(receiver),
            ])

            if (callerChess || receiverChess || callerCard || receiverCard) {
                return { allowed: false, reason: 'user_in_chess_or_card' }
            }

            const [callerRaceRoom, receiverRaceRoom] = await Promise.all([
                getActiveRaceGame(caller),
                getActiveRaceGame(receiver),
            ])

            const callerInRace = !!callerRaceRoom
            const receiverInRace = !!receiverRaceRoom

            // If no one is in race, normal call is allowed.
            if (!callerInRace && !receiverInRace) return { allowed: true, reason: 'ok' }

            // Allow only same-race opponents.
            if (callerInRace && receiverInRace && String(callerRaceRoom) === String(receiverRaceRoom)) {
                return { allowed: true, reason: 'same_race_room' }
            }

            return { allowed: false, reason: 'race_call_not_same_room' }
        }

        // WebRTC: Handle call user - emit to both receiver AND sender like madechess
        socket.on("callUser", async ({ userToCall, signalData, signal: signalAlt, from, name, callType = 'video', callId: clientCallId }) => {
            const signalPayload = signalData || signalAlt
            if (!signalPayload) {
                console.error('❌ [callUser] No signal/signalData in payload – rejecting')
                return
            }
            // Normalize IDs so we find receiver (mobile may send string/ObjectId; receiver registered with normalized id on connect)
            const receiverId = normalizeUserId(userToCall) || userToCall
            const callerId = normalizeUserId(from) || from
            if (!receiverId || !callerId) {
                console.error('❌ [callUser] Missing or invalid userToCall/from – rejecting', { userToCall, from })
                return
            }
            const gamePolicy = await evaluateGameCallPolicy(callerId, receiverId)
            if (!gamePolicy.allowed) {
                const senderData = await getUserSocket(callerId)
                const senderSocketId = senderData?.socketId
                if (senderSocketId) {
                    io.to(senderSocketId).emit("callBusyError", {
                        message: "Call blocked: user is in a game",
                        busyUserId: receiverId,
                        reason: gamePolicy.reason,
                    })
                }
                console.log(`🚫 [callUser] Blocked by game policy (${gamePolicy.reason}) caller:${callerId} receiver:${receiverId}`)
                return
            }
            // Check if either user is already in a call
            // CALLBACK FLOW LOG: When B calls A back after cancel, we need A and B both NOT busy
            await logInCallStatus('callUser BEFORE busy check (receiver=userToCall, caller=from)', receiverId, callerId)
            let userToCallBusy = await isUserBusy(receiverId)
            let fromBusy = await isUserBusy(callerId)
            const receiverDataEarly = await getUserSocket(receiverId)
            const receiverOffline = !(await resolveLiveSocketIdForUser(receiverId))

            // Helper: check if a user's inCall key references a call that involves BOTH callerId and receiverId.
            // Only then is it safe to clear – avoids wiping a live call with a DIFFERENT third party.
            const inCallInvolvesThisPair = async (userId) => {
                const entry = await getInCall(userId)
                if (!entry) return false
                const cid = String(entry.callId || '')
                return (
                    cid === `${callerId}-${receiverId}` ||
                    cid === `${receiverId}-${callerId}`
                )
            }

            // Self-heal: receiver is offline AND their inCall references only this pair (stale from a previous call)
            if (userToCallBusy && receiverOffline && (await inCallInvolvesThisPair(receiverId))) {
                console.log('📞 [callUser] CALLBACK_SELFHEAL: Receiver offline + stale inCall for this pair – clearing so callback can proceed')
                await clearInCall(receiverId).catch(() => {})
                userToCallBusy = await isUserBusy(receiverId)
            }
            // Self-heal: caller is marked busy, receiver is offline, and the caller's inCall references only this pair
            if (fromBusy && receiverOffline && (await inCallInvolvesThisPair(callerId))) {
                console.log('📞 [callUser] CALLBACK_SELFHEAL: Caller stale inCall for this pair – clearing so they can call back')
                await clearInCall(callerId).catch(() => {})
                fromBusy = await isUserBusy(callerId)
            }
            // Self-heal: either busy, no activeCall between THIS pair, AND inCall references only this pair
            // (i.e. cancelCall was lost / mobile didn't emit – not a live call with someone else)
            if (userToCallBusy || fromBusy) {
                const callId1 = `${callerId}-${receiverId}`
                const callId2 = `${receiverId}-${callerId}`
                const active1 = await getActiveCall(callId1)
                const active2 = await getActiveCall(callId2)
                if (!active1 && !active2) {
                    // Only clear inCall for a user if their entry references THIS pair, not a live call with someone else.
                    const receiverStale = userToCallBusy && (await inCallInvolvesThisPair(receiverId))
                    const callerStale   = fromBusy      && (await inCallInvolvesThisPair(callerId))
                    if (receiverStale || callerStale) {
                        console.log('📞 [callUser] CALLBACK_SELFHEAL: No active call between this pair + stale inCall – clearing so callback can proceed', { from: callerId, userToCall: receiverId })
                        if (receiverStale) await clearInCall(receiverId).catch(() => {})
                        if (callerStale)   await clearInCall(callerId).catch(() => {})
                        // Also clean up pendingCall / pendingAnswer for this pair
                        await Promise.all([
                            redisService.redisDel(`pendingCall:${receiverId}`).catch(() => {}),
                            redisService.redisDel(`pendingCall:${callerId}`).catch(() => {}),
                            redisService.redisDel(`${PENDING_ANSWER_PREFIX}${receiverId}`).catch(() => {}),
                            redisService.redisDel(`${PENDING_ANSWER_PREFIX}${callerId}`).catch(() => {}),
                        ])
                        userToCallBusy = await isUserBusy(receiverId)
                        fromBusy       = await isUserBusy(callerId)
                    }
                }
            }
            console.log('📞 [callUser] CALLBACK_CHECK: Busy status', {
                receiver: receiverId,
                receiverBusy: userToCallBusy,
                caller: callerId,
                callerBusy: fromBusy,
                willReject: userToCallBusy || fromBusy,
            })
            if (userToCallBusy || fromBusy) {
                const busyUserId = userToCallBusy ? receiverId : callerId
                console.log('❌ [callUser] CALLBACK_BLOCKED: Rejecting call - user is busy', {
                    busyUserId,
                    scenario: 'B_calls_A_after_cancel',
                    receiver: receiverId,
                    caller: callerId,
                })
                // Notify sender that the call cannot be made (user is busy)
                const senderData = await getUserSocket(callerId)
                const senderSocketId = senderData?.socketId
                if (senderSocketId) {
                    io.to(senderSocketId).emit("callBusyError", { 
                        message: "User is currently in a call",
                        busyUserId: userToCallBusy ? receiverId : callerId,
                        reason: "busy",
                        callId: clientCallId
                    })
                }
                return
            }

            // Get socket data from Redis (reuse lookup from above)
            const receiverData = receiverDataEarly
            const liveReceiverSocketId = await resolveLiveSocketIdForUser(receiverId)
            const rcvPresence = await getUserPresence(receiverId)
            const pr = rcvPresence != null ? String(rcvPresence).toLowerCase() : ''
            const clientMarkedOffline = pr === 'offline'
            // Safety for mobile: keep existing offline behavior unless receiver is an active WEB socket.
            // Web clients can be marked offline by another device (same userId), which blocks browser ringing.
            const receiverClientType = String(receiverData?.clientType || '').toLowerCase()
            const allowLiveSocketForWeb = clientMarkedOffline && receiverClientType === 'web' && !!liveReceiverSocketId
            const receiverSocketId = (clientMarkedOffline && !allowLiveSocketForWeb) ? null : liveReceiverSocketId

            const senderData = await getUserSocket(callerId)
            const senderSocketId = senderData?.socketId

            const payload = { signal: signalPayload, from: callerId, name, userToCall: receiverId, callType }
            if (clientCallId) payload.callId = clientCallId

            console.log(`📞 [callUser] Caller: ${name} (${callerId})`)
            console.log(
                `📞 [callUser] Receiver: ${receiverId} (liveSocket: ${liveReceiverSocketId || 'none'}, presenceOffline: ${clientMarkedOffline}, deliverSocket: ${!!receiverSocketId})`
            )
            console.log(`📞 [callUser] Receiver socket data:`, receiverData)

            if (allowLiveSocketForWeb) {
                console.log(`🌐 [callUser] Receiver marked offline but live WEB socket found — delivering in-app callUser`)
            } else if (clientMarkedOffline && liveReceiverSocketId) {
                console.log(`📱 [callUser] Receiver marked offline — FCM ring even though socket still connected`)
            }

            if (receiverSocketId) {
                console.log(`✅ [callUser] User ${receiverId} reachable in-app, sending callUser to socket ${receiverSocketId}`)
                io.to(receiverSocketId).emit("callUser", payload)
            } else {
                console.log(`📱 [callUser] User ${receiverId} needs push ring (no live in-app delivery path)`)
                console.log('📱 [callUser] CALLBACK_FCM: Sending FCM to receiver', {
                    receiver: receiverId,
                    caller: callerId,
                    callerName: name,
                    callType,
                    callId: clientCallId,
                })
                try {
                    console.log(`📤 [callUser] Calling sendCallNotification(${receiverId}, ${name}, ${callerId}, ${callType}, ${clientCallId || 'auto'})`)
                    const result = await sendCallNotification(receiverId, name, callerId, callType, clientCallId || null)
                    console.log('✅ [callUser] Push notification result:', result)

                    await setPendingCall(receiverId, {
                        callerId: callerId,
                        signal: signalPayload,
                        name: name,
                        callType: callType,
                        callId: clientCallId || null,
                        at: Date.now(),
                    })
                    console.log(`✅ [callUser] Stored pending call for ${receiverId} (indexed for fast lookup)`)
                } catch (error) {
                    console.error('❌ [callUser] Error sending call push notification:', error)
                    console.error('❌ [callUser] Error stack:', error.stack)
                    return
                }
            }

            if (senderSocketId) {
                io.to(senderSocketId).emit("callUser", payload)
            }

            const callId = `${callerId}-${receiverId}`
            // Mark inCall before activeCall so `isUserBusy` / scans never see activeCall without inCall (no orphan window).
            await Promise.all([
                setInCall(callerId, callId).catch(() => {}),
                setInCall(receiverId, callId).catch(() => {}),
            ])
            await setActiveCall(callId, {
                user1: callerId,
                user2: receiverId,
                signal: signalPayload,
                name: name,
                callType: callType
            })

            User.findByIdAndUpdate(callerId, { inCall: true }).catch(err => console.log('Error updating caller inCall status:', err))
            User.findByIdAndUpdate(receiverId, { inCall: true }).catch(err => console.log('Error updating receiver inCall status:', err))

            io.emit("callBusy", { userToCall: receiverId, from: callerId })
        })

        // WebRTC: Handle request call signal (when user comes online after receiving push notification)
        socket.on("requestCallSignal", async ({ callerId, receiverId, callId: clientCallId }) => {
            console.log(`📞 [requestCallSignal] Requesting call signal for ${receiverId} from ${callerId}`)
            // If receiver had a pending cancel while offline/backgrounded, do NOT resurrect the call.
            // Also ensure callId matches when provided (prevents mixing new call with old cancel).
            const pendingCancel = await getPendingCancel(receiverId)
            if (pendingCancel) {
                const cancelAgeMs = Date.now() - (Number(pendingCancel.at) || 0)
                const cancelCallId = pendingCancel.callId || null
                const callIdMatches = !clientCallId || !cancelCallId || String(clientCallId) === String(cancelCallId)
                if (cancelAgeMs < 180000 && callIdMatches) {
                    console.log('🧯 [requestCallSignal] Pending cancel exists — suppressing call signal resend', {
                        receiverId,
                        callerId,
                        cancelAgeMs,
                        cancelCallId,
                        clientCallId,
                    })
                    await deletePendingCancel(receiverId)
                    return
                }
            }
            
            // Check if there's an active call between these users
            const callId1 = `${callerId}-${receiverId}`
            const callId2 = `${receiverId}-${callerId}`
            const activeCall1 = await getActiveCall(callId1)
            const activeCall2 = await getActiveCall(callId2)
            
            const activeCall = activeCall1 || activeCall2
            
            if (activeCall) {
                console.log(`✅ [requestCallSignal] Active call found, re-sending signal directly`)
                
                // Get receiver's socket
                const receiverData = await getUserSocket(receiverId)
                const receiverSocketId = receiverData?.socketId
                
                if (receiverSocketId && activeCall.signal) {
                    // Re-send the call signal directly from stored data
                    io.to(receiverSocketId).emit("callUser", {
                        userToCall: receiverId,
                        signal: activeCall.signal,
                        from: callerId,
                        name: activeCall.name || 'Unknown',
                        callType: activeCall.callType || 'video'
                    })
                    console.log(`✅ [requestCallSignal] Call signal re-sent to receiver`)
                    // Deliver any ICE candidates that arrived while receiver was offline
                    const queued = await getAndClearPendingIce(receiverId)
                    if (queued.length > 0) {
                        for (const item of queued) {
                            const payload = { candidate: item.candidate, from: item.from }
                            if (item.callId) payload.callId = item.callId
                            io.to(receiverSocketId).emit("iceCandidate", payload)
                        }
                        console.log(`✅ [requestCallSignal] Delivered ${queued.length} queued ICE candidates to receiver`)
                    }
                } else if (!receiverSocketId) {
                    console.log(`⚠️ [requestCallSignal] Receiver ${receiverId} is not online`)
                } else if (!activeCall.signal) {
                    console.log(`⚠️ [requestCallSignal] No signal stored for this call`)
                    // Fallback: ask caller to re-send
                    const callerData = await getUserSocket(callerId)
                    const callerSocketId = callerData?.socketId
                    if (callerSocketId) {
                        io.to(callerSocketId).emit("resendCallSignal", { receiverId })
                    }
                }
            } else {
                // Fallback: Check pending calls (indexed lookup) in case active call wasn't found
                // This handles edge cases where pending call exists but active call wasn't stored
                const pendingCall = await getPendingCall(receiverId)
                const pendingCallId = pendingCall?.callId || null
                const callIdOk = !clientCallId || !pendingCallId || String(clientCallId) === String(pendingCallId)
                if (pendingCall && pendingCall.callerId === callerId && pendingCall.signal && callIdOk) {
                    console.log(`✅ [requestCallSignal] Found pending call, re-sending signal`)
                    const receiverData = await getUserSocket(receiverId)
                    const receiverSocketId = receiverData?.socketId
                    
                    if (receiverSocketId) {
                        io.to(receiverSocketId).emit("callUser", {
                            userToCall: receiverId,
                            signal: pendingCall.signal,
                            from: callerId,
                            name: pendingCall.name || 'Unknown',
                            callType: pendingCall.callType || 'video'
                        })
                        console.log(`✅ [requestCallSignal] Call signal re-sent from pending call`)
                        // Deliver any ICE candidates that arrived while receiver was offline
                        const queued = await getAndClearPendingIce(receiverId)
                        if (queued.length > 0) {
                            for (const item of queued) {
                                const payload = { candidate: item.candidate, from: item.from }
                                if (item.callId) payload.callId = item.callId
                                io.to(receiverSocketId).emit("iceCandidate", payload)
                            }
                            console.log(`✅ [requestCallSignal] Delivered ${queued.length} queued ICE candidates to receiver`)
                        }
                        await deletePendingCall(receiverId)
                    }
                } else {
                    console.log(`⚠️ [requestCallSignal] No active call or pending call found between ${callerId} and ${receiverId}`)
                }
            }
        })

        // WebRTC: Handle answer call
        socket.on("answerCall", async (data) => {
            const callerId = normalizeUserId(data.to) || data.to
            const receiverId = normalizeUserId(socket.handshake.query.userId) || socket.handshake.query.userId
            if (!callerId) {
                console.error('❌ [answerCall] Missing data.to (caller id)')
                return
            }
            const signal = data.signal
            if (!signal || (typeof signal === 'object' && !signal.sdp)) {
                console.error('❌ [answerCall] Missing or invalid signal (answer SDP)')
                return
            }
            const payload = { signal }
            if (data.callId) payload.callId = data.callId

            const callerData = await getUserSocket(callerId)
            const callerSocketId = callerData?.socketId
            if (!callerSocketId) {
                await setPendingAnswer(callerId, {
                    signal,
                    callId: data.callId || null,
                    from: receiverId || null,
                    at: Date.now(),
                })
                console.log('📦 [answerCall] Caller offline – queued answer for', callerId, '(deliver on reconnect, same as ICE)')
                if (receiverId) await deletePendingCall(receiverId)
                return
            }
            io.to(callerSocketId).emit("callAccepted", payload)
            console.log('✅ [answerCall] Delivered answer to caller', callerId, 'signalType:', signal.type || (signal.sdp ? 'answer' : '?'), 'sdpLength:', signal.sdp?.length ?? 0)
            if (receiverId) await deletePendingCall(receiverId)
        })


        // WebRTC: Sync "Connected" + call timer to the other peer so both show same status
        socket.on("callConnected", async ({ to, startTime, callId: clientCallId }) => {
            if (!to || typeof startTime !== 'number') return
            const data = await getUserSocket(to)
            const targetSocketId = data?.socketId
            if (targetSocketId) {
                const from = socket.handshake.query.userId
                const payload = { startTime, from }
                if (clientCallId) payload.callId = clientCallId
                io.to(targetSocketId).emit("callConnected", payload)
            }
        })

        // WebRTC: Handle ICE candidate (for mobile-to-mobile calls with trickle ICE)
        // When receiver is offline (e.g. opening app from FCM), queue candidates and deliver on requestCallSignal
        socket.on("iceCandidate", async ({ userToCall, candidate, from, callId: clientCallId }) => {
            console.log(`🧊 [iceCandidate] Forwarding ICE candidate from ${from} to ${userToCall}`)
            
            const receiverData = await getUserSocket(userToCall)
            const receiverSocketId = receiverData?.socketId
            
            if (receiverSocketId) {
                const payload = { candidate, from }
                if (clientCallId) payload.callId = clientCallId
                io.to(receiverSocketId).emit("iceCandidate", payload)
                console.log(`✅ [iceCandidate] ICE candidate forwarded successfully`)
            } else {
                await appendPendingIce(userToCall, { from, candidate, callId: clientCallId })
                console.log(`📦 [iceCandidate] Receiver ${userToCall} offline – queued candidate (will deliver when they connect)`)
            }
        })

        // WebRTC: Handle cancel call - optimized for 1M+ users
        // Scalability notes:
        // 1. Redis operations (getActiveCall, deleteActiveCall) are O(1) and fast
        // 2. Database updates are non-blocking (fire-and-forget with .catch)
        // 3. FCM notification is sent asynchronously
        // 4. Socket events are broadcast instantly via Redis-backed socket map
        socket.on("cancelCall", async ({ conversationId, sender, callId: clientCallId }) => {
            const dedupeKey = `${sender}:${conversationId}`
            const now = Date.now()
            if (cancelProcessedKeys.has(dedupeKey)) {
                console.log('📴 [cancelCall] Duplicate ignored (same cancel recently)', { conversationId, sender })
                return
            }
            cancelProcessedKeys.add(dedupeKey)
            setTimeout(() => cancelProcessedKeys.delete(dedupeKey), CANCEL_DEDUPE_TTL_MS)

            console.log('📴 [cancelCall] CALLBACK_FLOW: Cancel received', {
                conversationId,
                sender,
                note: 'conversationId=callee(gets call), sender=who cancelled',
                whenBCallsA: 'conversationId=A, sender=B',
            })
            const receiverData = await getUserSocket(conversationId)
            const receiverSocketId = receiverData?.socketId

            const senderData = await getUserSocket(sender)
            const senderSocketId = senderData?.socketId

            const cancelPayload = clientCallId ? { callId: clientCallId } : {}

            // Firm cleanup: one place for all call state (best practice, scale-ready)
            const callId1 = `${sender}-${conversationId}`
            const callId2 = `${conversationId}-${sender}`
            const call1 = await getActiveCall(callId1)
            const call2 = await getActiveCall(callId2)
            const hadActiveCall = !!(call1 || call2)
            await clearCallStateForPair(sender, conversationId)

            // If receiver is offline (no socketId), store a pending cancel ONLY when we were canceling a RING (no active call).
            // Include callId so requestCallSignal can suppress only the matching call.
            if (!receiverSocketId && conversationId && !hadActiveCall) {
                const pending = { from: sender, at: Date.now() }
                if (clientCallId) pending.callId = clientCallId
                await setPendingCancel(conversationId, pending)
            }

            // Send FCM "stop_ringtone" to receiver when: we had an active call OR receiver is offline (had pending call – phone was ringing).
            // So when Mu cancels and Saif was offline, Saif's phone still gets "call ended" and stops ringing.
            const shouldNotifyReceiver = hadActiveCall || !receiverSocketId
            if (shouldNotifyReceiver && conversationId) {
                try {
                    const { sendCallEndedNotificationToUser } = await import('../services/fcmNotifications.js')
                    const fcmResult = await sendCallEndedNotificationToUser(conversationId, sender)
                    if (fcmResult.success) {
                        console.log('✅ [cancelCall] Sent call ended FCM notification to receiver (stop ringtone)')
                    } else {
                        console.log('⚠️ [cancelCall] FCM call ended notification failed:', fcmResult.error)
                    }
                } catch (fcmError) {
                    console.error('❌ [cancelCall] Error sending FCM call ended notification:', fcmError)
                    console.error('❌ [cancelCall] Error details:', fcmError.message)
                }
            }

            // Always notify both sides via socket when connected, so the receiver stops ringing/incoming UI immediately.
            // hadActiveCall can be false when receiver was offline at start (we had pendingCall only; requestCallSignal then deleted it).
            if (receiverSocketId) io.to(receiverSocketId).emit("CallCanceled", cancelPayload)
            if (senderSocketId) io.to(senderSocketId).emit("CallCanceled", cancelPayload)
            if (hadActiveCall) {
                io.emit("cancleCall", { userToCall: conversationId, from: sender })
            }
        })

        // ── LiveKit signaling ────────────────────────────────────────────────
        // Notify callee with room info. Must mirror WebRTC reliability:
        // - Use resolveLiveSocketIdForUser (stale Redis socket rows are common)
        // - If clientPresence is offline (e.g. app backgrounded), FCM rings even when TCP socket still exists
        // - Retry socket emits briefly — RN listener may attach one tick after connect
        socket.on("livekit:callUser", async ({ userToCall, callerName, callerProfilePic, callType, roomName, callerId: explicitCallerId }) => {
            try {
                const callerId   = explicitCallerId || socket.handshake.query.userId
                const receiverId = normalizeUserId(userToCall) || String(userToCall)
                const gamePolicy = await evaluateGameCallPolicy(callerId, receiverId)
                if (!gamePolicy.allowed) {
                    const callerSocketData = await getUserSocket(String(callerId))
                    const callerSocketId = callerSocketData?.socketId
                    if (callerSocketId) {
                        io.to(callerSocketId).emit('livekit:callDeclined', {
                            by: receiverId,
                            roomName,
                            reason: gamePolicy.reason,
                        })
                    }
                    console.log(`🚫 [livekit:callUser] Blocked by game policy (${gamePolicy.reason}) caller:${callerId} receiver:${receiverId}`)
                    return
                }

                // Mark both as inCall (Redis + MongoDB)
                const callId = [String(callerId), receiverId].sort().join('-')
                await Promise.all([
                    setInCall(callerId,  callId).catch(() => {}),
                    setInCall(receiverId, callId).catch(() => {}),
                ])
                User.findByIdAndUpdate(callerId,  { inCall: true }).catch(() => {})
                User.findByIdAndUpdate(receiverId, { inCall: true }).catch(() => {})
                io.emit('callBusy', { userToCall: receiverId, from: callerId })

                const incomingPayload = {
                    from:            callerId,
                    callerName,
                    callerProfilePic,
                    callType:        callType || 'video',
                    roomName,
                }

                const receiverData = await getUserSocket(receiverId)
                const liveReceiverSocketId = await resolveLiveSocketIdForUser(receiverId)
                const rcvPresence = await getUserPresence(receiverId)
                const pr = rcvPresence != null ? String(rcvPresence).toLowerCase() : ''
                const clientMarkedOffline = pr === 'offline'
                const receiverClientType = String(receiverData?.clientType || '').toLowerCase()
                const allowLiveSocketForWeb = clientMarkedOffline && receiverClientType === 'web' && !!liveReceiverSocketId
                const deliverSocketId = (clientMarkedOffline && !allowLiveSocketForWeb) ? null : liveReceiverSocketId

                const emitIncomingTo = (sid) => {
                    if (!sid) return
                    io.to(sid).emit('livekit:incomingCall', incomingPayload)
                }

                if (deliverSocketId) {
                    emitIncomingTo(deliverSocketId)
                    console.log(`📞 [LiveKit] incomingCall sent to ${receiverId} (live socket ${deliverSocketId})`)
                    ;[350, 1200].forEach((ms) => {
                        setTimeout(async () => {
                            try {
                                const sid = await resolveLiveSocketIdForUser(receiverId)
                                if (sid) emitIncomingTo(sid)
                            } catch (_) {}
                        }, ms)
                    })
                } else {
                    console.log(`📞 [LiveKit] No live in-app socket for ${receiverId} (stale map or presence offline) — will use FCM`)
                }

                // FCM: truly offline OR mobile background (presence offline) — same idea as WebRTC callUser
                const needsFcm = !deliverSocketId || (clientMarkedOffline && receiverClientType !== 'web')
                if (needsFcm) {
                    try {
                        const { sendCallNotification } = await import('../services/pushNotifications.js')
                        await sendCallNotification(receiverId, callerName, callerId, callType || 'video')
                        console.log(`📬 [LiveKit] FCM call notification → ${receiverId} (needsFcm=${needsFcm})`)
                    } catch (fcmErr) {
                        console.error('❌ [LiveKit] FCM push failed:', fcmErr.message)
                    }
                }

                const directTimerKey = directCallTimerKey({ roomName, callerId, receiverId })
                if (directTimerKey) {
                    safeClearTimer(livekitDirectCallTimers, directTimerKey)
                    livekitDirectCallTimers.set(directTimerKey, setTimeout(async () => {
                        try {
                            await clearCallStateForPair(callerId, receiverId)
                            User.findByIdAndUpdate(callerId, { inCall: false }).catch(() => {})
                            User.findByIdAndUpdate(receiverId, { inCall: false }).catch(() => {})
                            io.emit('cancleCall', { userToCall: receiverId, from: callerId })

                            const timeoutPayload = { from: callerId, roomName, reason: 'timeout' }
                            const callerLiveSocketId = await resolveLiveSocketIdForUser(callerId)
                            const receiverLiveSocketId = await resolveLiveSocketIdForUser(receiverId)
                            if (callerLiveSocketId) io.to(callerLiveSocketId).emit('livekit:callCanceled', timeoutPayload)
                            if (receiverLiveSocketId) io.to(receiverLiveSocketId).emit('livekit:callCanceled', timeoutPayload)
                            console.log(`⏱️ [LiveKit] Direct call timed out (25m) caller:${callerId} receiver:${receiverId} room:${roomName || '-'}`)
                        } catch (timeoutErr) {
                            console.error('❌ [LiveKit] direct timeout cleanup failed:', timeoutErr.message)
                        } finally {
                            safeClearTimer(livekitDirectCallTimers, directTimerKey)
                        }
                    }, LIVEKIT_MAX_SESSION_MS))
                }
            } catch (err) {
                console.error('❌ [livekit:callUser]', err.message)
            }
        })

        // Caller cancelled before receiver answered  OR  either side ended the call
        socket.on("livekit:cancelCall", async ({ userToCall, roomName }) => {
            try {
                const callerId   = socket.handshake.query.userId
                const receiverId = String(userToCall)
                safeClearTimer(
                    livekitDirectCallTimers,
                    directCallTimerKey({ roomName, callerId, receiverId })
                )

                // Clear busy state
                await clearCallStateForPair(callerId, receiverId)
                User.findByIdAndUpdate(callerId,  { inCall: false }).catch(() => {})
                User.findByIdAndUpdate(receiverId, { inCall: false }).catch(() => {})
                io.emit('cancleCall', { userToCall: receiverId, from: callerId })

                const receiverSocketData = await getUserSocket(receiverId)
                const receiverSocketId   = receiverSocketData?.socketId
                const callerSocketData   = await getUserSocket(callerId)
                const callerSocketId     = callerSocketData?.socketId

                if (receiverSocketId) io.to(receiverSocketId).emit('livekit:callCanceled', { from: callerId, roomName })
                if (callerSocketId)   io.to(callerSocketId).emit('livekit:callCanceled',   { from: callerId, roomName })

                // FCM stop-ringtone for offline receiver
                try {
                    const { sendCallEndedNotificationToUser } = await import('../services/fcmNotifications.js')
                    await sendCallEndedNotificationToUser(receiverId, callerId)
                } catch (_) {}

                console.log(`📴 [LiveKit] cancelCall — caller:${callerId} receiver:${receiverId}`)
            } catch (err) {
                console.error('❌ [livekit:cancelCall]', err.message)
            }
        })

        // Receiver explicitly declines (sends back to caller)
        socket.on("livekit:declineCall", async ({ callerId, roomName }) => {
            try {
                const receiverId = socket.handshake.query.userId
                safeClearTimer(
                    livekitDirectCallTimers,
                    directCallTimerKey({ roomName, callerId, receiverId })
                )

                await clearCallStateForPair(callerId, receiverId)
                User.findByIdAndUpdate(callerId,  { inCall: false }).catch(() => {})
                User.findByIdAndUpdate(receiverId, { inCall: false }).catch(() => {})
                io.emit('cancleCall', { userToCall: receiverId, from: callerId })

                const callerSocketData = await getUserSocket(String(callerId))
                const callerSocketId   = callerSocketData?.socketId
                if (callerSocketId) io.to(callerSocketId).emit('livekit:callDeclined', { by: receiverId, roomName })

                console.log(`📴 [LiveKit] declineCall — receiver:${receiverId} declined caller:${callerId}`)
            } catch (err) {
                console.error('❌ [livekit:declineCall]', err.message)
            }
        })

        // Live stream: notify all followers that a user went live
        socket.on("livekit:goLive", async ({ streamerId, streamerName, streamerProfilePic, roomName }) => {
            try {
                const socketUserId = String(socket.handshake?.query?.userId || '')
                if (!socketUserId || String(streamerId) !== socketUserId) {
                    console.warn(`⚠️ [livekit:goLive] rejected mismatched streamerId:${streamerId} socketUser:${socketUserId}`)
                    return
                }
                const existingLive = await LiveStream.findOne({ streamer: streamerId, active: true }).lean()
                if (existingLive?.roomName === roomName) {
                    // Ignore duplicate emits from double-click/retry to avoid noisy feed updates.
                    return
                }
                // Save live stream to DB so feed can surface it
                await LiveStream.findOneAndUpdate(
                    { streamer: streamerId },
                    { streamer: streamerId, roomName, active: true, startedAt: new Date(), endedAt: null },
                    { upsert: true, new: true }
                )
                // Notify all followers via their personal rooms
                const streamerNorm = normalizeUserId(streamerId) || String(streamerId)
                const streamer = await User.findById(streamerId).select('followers').lean()
                if (streamer?.followers?.length) {
                    for (const followerId of streamer.followers) {
                        const fid = normalizeUserId(followerId) || String(followerId)
                        emitToUserSelf(fid, 'livekit:streamStarted', {
                            streamerId: streamerNorm,
                            streamerName,
                            streamerProfilePic,
                            roomName,
                        })
                    }
                }
                const streamTimerKey = normalizeUserId(streamerId)
                if (streamTimerKey) {
                    safeClearTimer(livekitStreamTimers, streamTimerKey)
                    livekitStreamTimers.set(streamTimerKey, setTimeout(async () => {
                        try {
                            await LiveStream.deleteMany({ streamer: streamerId })
                            const streamerNorm = normalizeUserId(streamerId) || String(streamerId)
                            const endPayload = { streamerId: streamerNorm, roomName, reason: 'timeout' }
                            const streamerDoc = await User.findById(streamerId).select('followers').lean()
                            if (streamerDoc?.followers?.length) {
                                for (const followerId of streamerDoc.followers) {
                                    const fid = normalizeUserId(followerId) || String(followerId)
                                    emitToUserSelf(fid, 'livekit:streamEnded', endPayload)
                                }
                            }
                            emitToUserSelf(streamerNorm, 'livekit:streamEnded', endPayload)
                            console.log(`⏱️ [LiveKit] Stream timed out (25m) streamer:${streamerId}`)
                        } catch (timeoutErr) {
                            console.error('❌ [LiveKit] stream timeout cleanup failed:', timeoutErr.message)
                        } finally {
                            safeClearTimer(livekitStreamTimers, streamTimerKey)
                        }
                    }, LIVEKIT_MAX_SESSION_MS))
                }
                console.log(`🔴 [LiveKit] ${streamerName} went live — room:${roomName}`)
            } catch (err) {
                console.error('❌ [livekit:goLive]', err.message)
            }
        })

        // Live stream ended
        socket.on("livekit:endLive", async ({ streamerId, roomName }) => {
            try {
                const socketUserId = String(socket.handshake?.query?.userId || '')
                if (!socketUserId || String(streamerId) !== socketUserId) {
                    console.warn(`⚠️ [livekit:endLive] rejected mismatched streamerId:${streamerId} socketUser:${socketUserId}`)
                    return
                }
                safeClearTimer(livekitStreamTimers, normalizeUserId(streamerId))
                // Remove ended live stream from DB so no stale live row remains.
                await LiveStream.deleteMany({ streamer: streamerId })
                const streamerNorm = normalizeUserId(streamerId) || String(streamerId)
                const endPayload = { streamerId: streamerNorm, roomName }
                const streamer = await User.findById(streamerId).select('followers').lean()
                if (streamer?.followers?.length) {
                    for (const followerId of streamer.followers) {
                        const fid = normalizeUserId(followerId) || String(followerId)
                        emitToUserSelf(fid, 'livekit:streamEnded', endPayload)
                    }
                }
                emitToUserSelf(streamerNorm, 'livekit:streamEnded', endPayload)
                console.log(`⬛ [LiveKit] Stream ended — streamer:${streamerId}`)
            } catch (err) {
                console.error('❌ [livekit:endLive]', err.message)
            }
        })
        // ── Group call signaling ─────────────────────────────────────────────
        /**
         * livekit:startGroupCall — caller starts a group call in a conversation.
         * Notifies every online member (except caller). Offline members get FCM.
         * payload: { conversationId, callerName, callerProfilePic, callType, roomName }
         */
        socket.on("livekit:startGroupCall", async ({ conversationId, callerName, callerProfilePic, callType, roomName }) => {
            try {
                // Must match direct-call path: handshake ids can differ from DB participant strings (ObjectId formatting).
                const callerId = normalizeUserId(socket.handshake.query.userId) || String(socket.handshake.query.userId || '')
                const conv = await Conversation.findById(conversationId).lean()
                if (!conv) return

                const otherIds = conv.participants
                    .map((p) => normalizeUserId(p) || String(p))
                    .filter((id) => id && id !== callerId)

                const incomingPayload = {
                    conversationId,
                    roomName,
                    callerId,
                    callerName,
                    callerProfilePic,
                    callType: callType || 'video',
                }

                for (const memberId of otherIds) {
                    const uid = normalizeUserId(memberId) || String(memberId)
                    // In-memory userSocketMap alone misses Redis-only rows (multi-instance / restart). Mirror livekit:callUser.
                    const receiverData = await getUserSocket(uid)
                    const liveReceiverSocketId = await resolveLiveSocketIdForUser(uid)
                    const rcvPresence = await getUserPresence(uid)
                    const pr = rcvPresence != null ? String(rcvPresence).toLowerCase() : ''
                    const clientMarkedOffline = pr === 'offline'
                    const receiverClientType = String(receiverData?.clientType || '').toLowerCase()
                    const allowLiveSocketForWeb = clientMarkedOffline && receiverClientType === 'web' && !!liveReceiverSocketId
                    const deliverSocketId = (clientMarkedOffline && !allowLiveSocketForWeb) ? null : liveReceiverSocketId

                    const emitIncomingTo = (sid) => {
                        if (!sid) return
                        io.to(sid).emit('livekit:incomingGroupCall', incomingPayload)
                    }

                    if (deliverSocketId) {
                        emitIncomingTo(deliverSocketId)
                        console.log(`📞 [livekit:startGroupCall] incomingGroupCall → ${uid} socket ${deliverSocketId}`)
                        ;[350, 1200].forEach((ms) => {
                            setTimeout(async () => {
                                try {
                                    const sid = await resolveLiveSocketIdForUser(uid)
                                    if (sid) emitIncomingTo(sid)
                                } catch (_) {}
                            }, ms)
                        })
                    } else {
                        console.log(`📞 [livekit:startGroupCall] No live in-app socket for ${uid} — will use FCM if token present`)
                    }

                    const needsFcm = !deliverSocketId || (clientMarkedOffline && receiverClientType !== 'web')
                    if (needsFcm) {
                        try {
                            const memberUser = await User.findById(uid).select('fcmToken').lean()
                            if (memberUser?.fcmToken) {
                                const { sendCallNotification } = await import('../utils/fcmHelper.js')
                                await sendCallNotification(memberUser.fcmToken, {
                                    type: 'incoming_group_call',
                                    callerId,
                                    callerName,
                                    callerProfilePic: callerProfilePic || '',
                                    callType: callType || 'video',
                                    conversationId,
                                    roomName,
                                })
                            }
                        } catch (fcmErr) {
                            console.warn('⚠️ [livekit:startGroupCall] FCM error:', fcmErr.message)
                        }
                    }
                }
                const groupTimerKey = groupCallTimerKey({ roomName, conversationId })
                if (groupTimerKey) {
                    safeClearTimer(livekitGroupCallTimers, groupTimerKey)
                    livekitGroupCallTimers.set(groupTimerKey, setTimeout(async () => {
                        try {
                            const convDoc = await Conversation.findById(conversationId).lean()
                            if (!convDoc) return
                            const participantIds = convDoc.participants.map(p => String(p))
                            for (const participantId of participantIds) {
                                const participantSocket = await getUserSocket(String(participantId))
                                if (participantSocket?.socketId) {
                                    io.to(participantSocket.socketId).emit('livekit:groupCallEnded', {
                                        conversationId,
                                        roomName,
                                        by: 'system',
                                        reason: 'timeout',
                                    })
                                }
                            }
                            console.log(`⏱️ [LiveKit] Group call timed out (25m) room:${roomName || '-'} conversation:${conversationId}`)
                        } catch (timeoutErr) {
                            console.error('❌ [LiveKit] group timeout cleanup failed:', timeoutErr.message)
                        } finally {
                            safeClearTimer(livekitGroupCallTimers, groupTimerKey)
                        }
                    }, LIVEKIT_MAX_SESSION_MS))
                }
                console.log(`📞 [LiveKit] Group call started — room:${roomName} members:${otherIds.length}`)
            } catch (err) {
                console.error('❌ [livekit:startGroupCall]', err.message)
            }
        })

        /**
         * livekit:endGroupCall — a participant leaves/ends the group call.
         * Notifies remaining online members.
         */
        socket.on("livekit:endGroupCall", async ({ conversationId, roomName }) => {
            try {
                const userId = normalizeUserId(socket.handshake.query.userId) || String(socket.handshake.query.userId || '')
                const conv   = await Conversation.findById(conversationId).lean()
                if (!conv) return
                safeClearTimer(
                    livekitGroupCallTimers,
                    groupCallTimerKey({ roomName, conversationId })
                )

                const otherIds = conv.participants
                    .map((p) => normalizeUserId(p) || String(p))
                    .filter((id) => id && id !== userId)

                for (const memberId of otherIds) {
                    const uid = normalizeUserId(memberId) || String(memberId)
                    const liveSid = await resolveLiveSocketIdForUser(uid)
                    if (liveSid) {
                        io.to(liveSid).emit('livekit:groupCallEnded', {
                            conversationId,
                            roomName,
                            by: userId,
                        })
                    }
                }
            } catch (err) {
                console.error('❌ [livekit:endGroupCall]', err.message)
            }
        })
        // ── end LiveKit signaling ─────────────────────────────────────────────

        // Mark messages as seen
        socket.on("markmessageasSeen", async ({ conversationId, userId }) => {
            try {
                // Get the current user's ID from socket
                const currentUserId = socket.handshake.query.userId

                // 1:1: `userId` is the other participant sender.
                // Group: `userId` may be missing/null; mark all unseen messages not sent by current user.
                const seenFilter = {
                    conversationId: conversationId,
                    seen: false,
                }
                if (userId) {
                    seenFilter.sender = userId
                } else if (currentUserId) {
                    seenFilter.sender = { $ne: currentUserId }
                }

                await Message.updateMany(seenFilter, { $set: { seen: true } })
                // Update conversation's lastMessage.seen to true
                await Conversation.updateOne(
                    { _id: conversationId },
                    { $set: { "lastMessage.seen": true } }
                )
                
                // Emit read receipts:
                // - 1:1: notify the explicit sender (`userId`)
                // - Group: notify other participants currently online
                if (userId) {
                    const senderData = await getUserSocket(userId)
                    const senderSocketId = senderData?.socketId
                    if (senderSocketId) {
                        io.to(senderSocketId).emit("messagesSeen", { conversationId })
                    }
                } else {
                    const conversation = await Conversation.findById(conversationId).select('participants')
                    const participantIds = (conversation?.participants || [])
                        .map((p) => p?.toString?.())
                        .filter((pid) => pid && pid !== currentUserId)

                    await Promise.all(
                        participantIds.map(async (pid) => {
                            const participantSocket = await getUserSocket(pid)
                            if (participantSocket?.socketId) {
                                io.to(participantSocket.socketId).emit("messagesSeen", { conversationId })
                            }
                        })
                    )
                }
                
                // Notify the reader (not the sender) so they can clear local unread — do NOT use `messagesSeen`
                // here: that event is for the *sender* to update read receipts on their outgoing messages.
                // Sending `messagesSeen` to the reader made clients flip their own bubbles to ✓✓ incorrectly.
                if (currentUserId && currentUserId !== userId) {
                    const currentUserData = await getUserSocket(currentUserId)
                    const currentUserSocketId = currentUserData?.socketId
                    if (currentUserSocketId) {
                        io.to(currentUserSocketId).emit("conversationMarkedRead", { conversationId })

                        // 2 queries instead of N+1:
                        //   1. distinct() on conversations index → array of IDs
                        //   2. single countDocuments() using compound index { conversationId, seen, sender }
                        try {
                            const convIds = await Conversation.distinct('_id', { participants: currentUserId })
                            const totalUnreadCount = await Message.countDocuments({
                                conversationId: { $in: convIds },
                                seen: false,
                                sender: { $ne: currentUserId },
                            })
                            io.to(currentUserSocketId).emit("unreadCountUpdate", { totalUnread: totalUnreadCount })
                        } catch (error) {
                            console.log('Error calculating unread count:', error)
                        }
                    }
                }
            } catch (error) {
                console.log("Error marking messages as seen:", error)
            }
        })

        // Recipient confirms message reached their app (WhatsApp-style double gray tick).
        // Payload: { messageId } or { messageIds: string[] }
        socket.on('ackMessageDelivered', async (payload = {}) => {
            try {
                const ackerRaw = socket.handshake.query.userId
                const ackerId = normalizeUserId(ackerRaw) || (ackerRaw && String(ackerRaw))
                if (!ackerId || ackerId === 'undefined') return

                const rawList = Array.isArray(payload.messageIds)
                    ? payload.messageIds
                    : payload.messageId
                      ? [payload.messageId]
                      : []
                const uniqueIds = [...new Set(rawList.map((id) => String(id).trim()).filter(Boolean))].slice(0, 50)
                if (!uniqueIds.length) return

                const objectIds = []
                for (const id of uniqueIds) {
                    if (!mongoose.isValidObjectId(id)) continue
                    objectIds.push(new mongoose.Types.ObjectId(id))
                }
                if (!objectIds.length) return

                const msgs = await Message.find({
                    _id: { $in: objectIds },
                    delivered: { $ne: true },
                }).lean()

                const convCache = new Map()
                for (const msg of msgs) {
                    const senderStr = normalizeUserId(msg.sender) || msg.sender?.toString?.()
                    if (!senderStr || senderStr === ackerId) continue

                    const convId = msg.conversationId?.toString?.()
                    if (!convId) continue

                    let partStrs = convCache.get(convId)
                    if (!partStrs) {
                        const conv = await Conversation.findById(convId).select('participants').lean()
                        if (!conv?.participants?.length) continue
                        partStrs = conv.participants.map((p) => p.toString())
                        convCache.set(convId, partStrs)
                    }
                    if (!partStrs.includes(ackerId)) continue

                    await Message.updateOne({ _id: msg._id }, { $set: { delivered: true } })

                    const senderData = await getUserSocket(senderStr)
                    const senderSocketId = senderData?.socketId
                    if (senderSocketId) {
                        io.to(senderSocketId).emit('messageDelivered', {
                            messageId: msg._id.toString(),
                            conversationId: convId,
                        })
                    }
                }
            } catch (e) {
                console.warn('ackMessageDelivered error:', e?.message || e)
            }
        })

        // Allow clients to (re-)join a conversation room.
        // Needed when a user is added to a new group while already connected — the initial
        // "join all rooms on connect" only covers rooms that existed at connection time.
        socket.on('joinConversationRoom', async ({ conversationId }) => {
            try {
                const convIdStr = String(conversationId || '').trim()
                if (!convIdStr || !mongoose.isValidObjectId(convIdStr)) return
                const uid = normalizeUserId(userId)
                if (!uid) return
                const { default: Conversation } = await import('../models/conversation.js')
                const conv = await Conversation.findById(convIdStr).select('participants').lean()
                if (!conv?.participants?.some(p => p.toString() === uid)) return
                socket.join(convIdStr)
            } catch (e) {
                console.error('❌ [socket] joinConversationRoom error:', e.message)
            }
        })

        // Typing indicator - user started typing
        socket.on("typingStart", async ({ from, to, conversationId, isGroup }) => {
            if (isGroup && conversationId) {
                // Group: broadcast to room (socket.to excludes the sender)
                socket.to(String(conversationId)).emit("userTyping", { userId: from, conversationId, isTyping: true })
                return
            }
            const recipientData = await getUserSocket(to)
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("userTyping", { userId: from, conversationId, isTyping: true })
            }
        })

        // Typing indicator - user stopped typing
        socket.on("typingStop", async ({ from, to, conversationId, isGroup }) => {
            if (isGroup && conversationId) {
                socket.to(String(conversationId)).emit("userTyping", { userId: from, conversationId, isTyping: false })
                return
            }
            const recipientData = await getUserSocket(to)
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("userTyping", { userId: from, conversationId, isTyping: false })
            }
        })

        // Chess Challenge Events
        socket.on("chessChallenge", async ({ from, to, fromName, fromUsername, fromProfilePic }) => {
            const fromId = normalizeUserId(from) || from
            const toId = normalizeUserId(to) || to
            console.log(`♟️ Chess challenge from ${fromId} to ${toId}`)
            if (await isBlockedForGameChallenge(fromId) || await isBlockedForGameChallenge(toId)) {
                const senderSock = await getUserSocket(fromId)
                if (senderSock?.socketId) {
                    io.to(senderSock.socketId).emit('gameChallengeBlocked', { game: 'chess', to: toId })
                }
                console.warn(`♟️ [chessChallenge] Blocked (call or active game)`, { fromId, toId })
                return
            }
            const recipientData = await getUserSocket(toId)
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("chessChallenge", {
                    from: fromId,
                    to: toId,
                    fromName,
                    fromUsername,
                    fromProfilePic
                })
            } else {
                console.warn(`⚠️ [chessChallenge] No socket for recipient ${toId} — challenge not delivered`)
            }
        })

        socket.on("acceptChessChallenge", async ({ from, to, roomId }) => {
            const fromId = normalizeUserId(from) || from
            const toId = normalizeUserId(to) || to
            console.log(`♟️ Chess challenge accepted: ${roomId}`)
            console.log(`♟️ Challenger (to): ${toId} → WHITE`)
            console.log(`♟️ Accepter (from): ${fromId} → BLACK`)

            const challengerSock = await getUserSocket(toId)
            const challengerSocketId = challengerSock?.socketId
            const accepterSock = await getUserSocket(fromId)
            const accepterSocketId = accepterSock?.socketId

            // Create chess room and join both players to Socket.IO room
            if (roomId) {
                await setActiveChessGame(toId, roomId)
                await setActiveChessGame(fromId, roomId)

                if (challengerSocketId) {
                    const challengerSocket = io.sockets.sockets.get(challengerSocketId)
                    if (challengerSocket) {
                        challengerSocket.join(roomId)
                        console.log(`♟️ Challenger ${toId} joined room: ${roomId}`)
                    }
                }
                if (accepterSocketId) {
                    const accepterSocket = io.sockets.sockets.get(accepterSocketId)
                    if (accepterSocket) {
                        accepterSocket.join(roomId)
                        console.log(`♟️ Accepter ${fromId} joined room: ${roomId}`)
                    }
                }
                console.log(`♟️ Created chess room: ${roomId} with both players`)
            }

            const challengerPayload = {
                roomId,
                yourColor: 'white',
                opponentId: fromId,
            }
            const accepterPayload = {
                roomId,
                yourColor: 'black',
                opponentId: toId,
            }
            // IMPORTANT: Always queue pending accept for both users.
            // A brief disconnect / listener timing issue can cause the live emit to be missed.
            // The next socket connect will deliver this one-shot payload.
            if (toId) await setPendingChessAcceptForUser(toId, challengerPayload)
            if (fromId) await setPendingChessAcceptForUser(fromId, accepterPayload)

            // IMPORTANT: Don't check "local" socket existence via io.sockets.sockets.get(socketId).
            // With Redis adapter / multiple server instances, io.to(socketId).emit will still route correctly,
            // but io.sockets.sockets.get() only sees sockets on the current node.
            if (challengerSocketId) {
                io.to(challengerSocketId).emit('acceptChessChallenge', challengerPayload)
            }

            if (accepterSocketId) {
                io.to(accepterSocketId).emit('acceptChessChallenge', accepterPayload)
            }

            // Broadcast busy status to ALL online users so they know these users are in a game
            // This allows the chess challenge modal to filter out busy users
            io.emit("userBusyChess", { userId: fromId })
            io.emit("userBusyChess", { userId: toId })
            
            // Initialize game state (starting position) in Redis
            if (roomId) {
                await setChessGameState(roomId, {
                    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                    capturedWhite: [],
                    capturedBlack: [],
                    lastUpdated: Date.now()
                })
                console.log(`💾 Initialized game state for room ${roomId} in Redis`)
            }
            
            // Create chess game post in feed for followers
            // Use setTimeout to ensure socket connections are fully established
            // This is important because the post creation happens immediately when game starts,
            // but followers' sockets might not be registered in userSocketMap yet
            setTimeout(() => {
                createChessGamePost(toId, fromId, roomId).catch(err => {
                    console.error('❌ [socket] Error creating chess game post:', err)
                })
            }, 900) // Delay so challenger socket often re-registers after accept (mobile/Wi‑Fi churn)
        })

        socket.on("declineChessChallenge", async ({ from, to }) => {
            const fromId = normalizeUserId(from) || from
            const toId = normalizeUserId(to) || to
            console.log(`♟️ Chess challenge declined by ${fromId}`)
            await deletePendingChessAcceptForUser(fromId).catch(() => {})
            await deletePendingChessAcceptForUser(toId).catch(() => {})
            const challengerData = await getUserSocket(toId)
            const challengerSocketId = challengerData?.socketId
            if (challengerSocketId) {
                io.to(challengerSocketId).emit("chessDeclined", { from: fromId })
            }
        })

        // Join chess room for spectators
        socket.on("joinChessRoom", async ({ roomId }) => {
            if (roomId) {
                // CRITICAL: Leave all other chess rooms first to prevent receiving events from multiple games
                // Get all rooms the socket is currently in
                const socketRooms = Array.from(socket.rooms)
                for (const currentRoom of socketRooms) {
                    // Only leave chess rooms (format: chess_player1_player2_timestamp)
                    if (currentRoom.startsWith('chess_') && currentRoom !== roomId) {
                        console.log(`♟️ [joinChessRoom] Leaving old chess room: ${currentRoom} (socket: ${socket.id})`)
                        socket.leave(currentRoom)
                        // Also remove from Redis tracking
                        const oldRoom = await getChessRoom(currentRoom)
                        if (oldRoom && Array.isArray(oldRoom)) {
                            const updatedRoom = oldRoom.filter(id => id !== socket.id)
                            await setChessRoom(currentRoom, updatedRoom)
                        }
                    }
                }
                
                // Get or create chess room from Redis
                let room = await getChessRoom(roomId)
                if (!room) {
                    room = []
                    await setChessRoom(roomId, room)
                }
                const wasAlreadyInRoom = room.includes(socket.id)
                
                if (!wasAlreadyInRoom) {
                    room.push(socket.id)
                    await setChessRoom(roomId, room) // Update in Redis
                }
                
                // Always join the Socket.IO room (even if already tracked)
                socket.join(roomId)
                
                if (!wasAlreadyInRoom) {
                    console.log(`👁️ Spectator joined chess room: ${roomId} (socket: ${socket.id})`)
                } else {
                    console.log(`👁️ Spectator rejoined chess room: ${roomId} (socket: ${socket.id})`)
                }
                
                // ALWAYS send current game state when joining/rejoining (for catch-up)
                // This ensures spectators see current position even if they navigate away and come back
                const gameState = await getChessGameState(roomId)
                
                // Extract player IDs from roomId (format: chess_player1_player2_timestamp)
                // player1 = challenger (WHITE), player2 = accepter (BLACK)
                let player1Id = null
                let player2Id = null
                const roomIdParts = roomId.split('_')
                if (roomIdParts.length >= 3) {
                    player1Id = roomIdParts[1] // Challenger (WHITE)
                    player2Id = roomIdParts[2] // Accepter (BLACK)
                }
                
                if (gameState) {
                    console.log(`📤 Sending game state to spectator for catch-up:`, {
                        roomId,
                        fen: gameState.fen,
                        capturedWhite: gameState.capturedWhite?.length || 0,
                        capturedBlack: gameState.capturedBlack?.length || 0,
                        lastUpdated: new Date(gameState.lastUpdated).toISOString(),
                        isRejoin: wasAlreadyInRoom,
                        player1Id,
                        player2Id
                    })
                    // Use io.to() to ensure it reaches the spectator socket
                    io.to(socket.id).emit("chessGameState", {
                        roomId,
                        fen: gameState.fen,
                        capturedWhite: gameState.capturedWhite || [],
                        capturedBlack: gameState.capturedBlack || [],
                        player1Id, // WHITE player (challenger)
                        player2Id  // BLACK player (accepter)
                    })
                } else {
                    console.log(`⚠️ No game state found for room ${roomId} - game may not have started yet`)
                    // Send empty state (starting position)
                    io.to(socket.id).emit("chessGameState", {
                        roomId,
                        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                        capturedWhite: [],
                        capturedBlack: [],
                        player1Id, // WHITE player (challenger)
                        player2Id  // BLACK player (accepter)
                    })
                }
            }
        })

        socket.on("chessMove", async ({ roomId, move, to, fen, capturedWhite, capturedBlack }) => {
            console.log(`♟️ Chess move received from ${socket.handshake.query.userId} to ${to}`)
            console.log(`♟️ Move data:`, move)
            
            // Update game state in backend (for spectator catch-up) - Redis
            if (roomId && fen) {
                await setChessGameState(roomId, {
                    fen,
                    capturedWhite: capturedWhite || [],
                    capturedBlack: capturedBlack || [],
                    lastUpdated: Date.now()
                })
                console.log(`💾 Updated game state for room ${roomId}:`, {
                    fen: fen.substring(0, 50) + '...',
                    capturedWhite: capturedWhite?.length || 0,
                    capturedBlack: capturedBlack?.length || 0
                })
            } else {
                console.warn(`⚠️ Cannot update game state - missing roomId or fen:`, { roomId: !!roomId, fen: !!fen })
            }
            
            // Emit to the opponent (specific user)
            const recipientData = await getUserSocket(to)
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                console.log(`♟️ Forwarding move to ${to} (socket: ${recipientSocketId})`)
                // Send move in same format as madechess: { move: moveObject }
                // Include roomId so client can verify they're viewing the correct game
                io.to(recipientSocketId).emit("opponentMove", { move, roomId })
            } else {
                console.log(`⚠️ Recipient ${to} not found in socket map`)
            }
            
            // ALSO emit to all spectators in the room (if roomId exists)
            // Use Socket.IO room system - if anyone joined the room, broadcast to them
            if (roomId) {
                // Check if room exists (has at least one socket joined)
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    console.log(`👁️ Broadcasting move to ${room.size} sockets in room ${roomId}`)
                    // Emit to all sockets in the room (including players and spectators)
                    // Include roomId in data so clients can verify they're viewing the correct game
                    io.to(roomId).emit("opponentMove", { move, roomId })
                } else {
                    console.log(`⚠️ Room ${roomId} doesn't exist or is empty`)
                }
            }
        })

        socket.on("resignChess", async ({ roomId, to }) => {
            const recipientData = await getUserSocket(to)
            const recipientSocketId = recipientData?.socketId
            const resignerData = await getUserSocket(socket.handshake.query.userId)
            const resignerSocketId = resignerData?.socketId
            const userId = socket.handshake.query.userId
            
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("opponentResigned")
            }
            
            // Emit cleanup event to both players to clear localStorage
            if (resignerSocketId) {
                io.to(resignerSocketId).emit("chessGameCleanup")
            }
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("chessGameCleanup")
            }
            
            // Notify all spectators in the room that game ended
            if (roomId) {
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    console.log(`👁️ Notifying ${room.size} spectators that game ended (resign)`)
                    io.to(roomId).emit("chessGameEnded", { roomId, reason: 'resigned' })
                }
            }
            
            // Delete chess game post immediately
            if (roomId) {
                deleteChessGamePost(roomId).catch(err => {
                    console.error('❌ Error deleting chess game post on resign:', err)
                })
                // Remove from active games tracking (Redis)
                await deleteActiveChessGame(userId)
                await deleteActiveChessGame(to)
                await deletePendingChessAcceptForUser(userId).catch(() => {})
                await deletePendingChessAcceptForUser(to).catch(() => {})
                // Clean up game state (Redis)
                await deleteChessGameState(roomId)
                console.log(`🗑️ Cleaned up game state for room ${roomId}`)
            }
            
            // Make users available again - TARGETED to specific users only (not all users)
            // This is critical for scalability - don't broadcast to 1M users!
            if (resignerSocketId) {
                // Broadcast to all users that these players are now available
                io.emit("userAvailableChess", { userId })
                io.emit("userAvailableChess", { userId: to })
            }
            if (recipientSocketId) {
                // Already broadcast above, but keep this for consistency
            }
        })

        socket.on("chessGameEnd", async ({ roomId, player1, player2, reason }) => {
            // The player who emitted this event is leaving or game ended normally
            const currentUserId = socket.handshake.query.userId
            const player1Data = await getUserSocket(player1)
            const player1SocketId = player1Data?.socketId
            const player2Data = await getUserSocket(player2)
            const player2SocketId = player2Data?.socketId
            
            // Determine which player left and who the other player is
            const leavingPlayerSocketId = currentUserId === player1 ? player1SocketId : player2SocketId
            const otherPlayerId = currentUserId === player1 ? player2 : player1
            const otherPlayerSocketId = currentUserId === player1 ? player2SocketId : player1SocketId
            
            // If game ended normally (checkmate/draw), notify both players
            if (reason === 'game_over' || reason === 'checkmate' || reason === 'draw') {
                if (player1SocketId) {
                    io.to(player1SocketId).emit("chessGameCleanup")
                }
                if (player2SocketId) {
                    io.to(player2SocketId).emit("chessGameCleanup")
                }
            } else {
                // Player left - notify the other player
                if (otherPlayerSocketId) {
                    io.to(otherPlayerSocketId).emit("opponentLeftGame")
                    io.to(otherPlayerSocketId).emit("chessGameCleanup")
                }
                
                // Cleanup for the player who left
                if (leavingPlayerSocketId) {
                    io.to(leavingPlayerSocketId).emit("chessGameCleanup")
                }
            }
            
            // Notify all spectators in the room that game ended
            if (roomId) {
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    const endReason = reason || 'player_left'
                    console.log(`👁️ Notifying ${room.size} spectators that game ended (${endReason})`)
                    io.to(roomId).emit("chessGameEnded", { roomId, reason: endReason })
                }
            }
            
            // Delete chess game post immediately
            if (roomId) {
                deleteChessGamePost(roomId).catch(err => {
                    console.error('❌ Error deleting chess game post on game end:', err)
                })
                // Remove from active games tracking (Redis)
                await deleteActiveChessGame(player1)
                await deleteActiveChessGame(player2)
                await deletePendingChessAcceptForUser(player1).catch(() => {})
                await deletePendingChessAcceptForUser(player2).catch(() => {})
                // Clean up game state (Redis)
                await deleteChessGameState(roomId)
                console.log(`🗑️ Cleaned up game state for room ${roomId}`)
            }
            
            // Make users available again - TARGETED to specific users only (not all users)
            // This is critical for scalability - don't broadcast to 1M users!
            if (player1SocketId) {
                // Broadcast to all users that these players are now available
                io.emit("userAvailableChess", { userId: player1 })
                io.emit("userAvailableChess", { userId: player2 })
            }
            if (player2SocketId) {
                // Already broadcast above, but keep this for consistency
            }
        })

        // ── 🏎️ Racing Game Events ────────────────────────────────────────────────────

        socket.on('raceChallenge', async ({ from, to, fromName, fromUsername, fromProfilePic }) => {
            const fromId = normalizeUserId(from) || from
            const toId = normalizeUserId(to) || to
            console.log(`🏎️ Race challenge from ${fromId} to ${toId}`)
            // Block if either player is already in a race, chess, or card game
            if (await isBlockedForGameChallenge(fromId) || await isBlockedForGameChallenge(toId)) {
                const senderSock = await getUserSocket(fromId)
                if (senderSock?.socketId) {
                    io.to(senderSock.socketId).emit('gameChallengeBlocked', { game: 'race', to: toId })
                }
                console.warn(`🏎️ [raceChallenge] Blocked (user busy)`, { fromId, toId })
                return
            }
            const recipientData = await getUserSocket(toId)
            if (recipientData?.socketId) {
                io.to(recipientData.socketId).emit('raceChallenge', { from: fromId, fromName, fromUsername, fromProfilePic })
            } else {
                console.warn(`⚠️ [raceChallenge] No socket for ${toId}`)
            }
        })

        socket.on('acceptRaceChallenge', async ({ from, to, roomId }) => {
            const fromId = normalizeUserId(from) || from  // accepter
            const toId = normalizeUserId(to) || to         // challenger
            if (!roomId) return
            console.log(`🏎️ Race challenge accepted — room: ${roomId}`)

            await setActiveRaceGame(fromId, roomId)
            await setActiveRaceGame(toId, roomId)

            const gameState = {
                player1: toId,
                player2: fromId,
                startTime: Date.now(),
                totalLaps: 3,
                readyPlayers: [],
            }
            await setRaceGameState(roomId, gameState)

            const challengerSock = await getUserSocket(toId)
            const accepterSock = await getUserSocket(fromId)

            if (challengerSock?.socketId) {
                const s = io.sockets.sockets.get(challengerSock.socketId)
                if (s) s.join(roomId)
                io.to(challengerSock.socketId).emit('acceptRaceChallenge', { roomId, opponentId: fromId })
            }
            if (accepterSock?.socketId) {
                const s = io.sockets.sockets.get(accepterSock.socketId)
                if (s) s.join(roomId)
                io.to(accepterSock.socketId).emit('acceptRaceChallenge', { roomId, opponentId: toId })
            }
            // Tell all clients these two users are now in a race (for busy-status UI)
            io.emit('userBusyRace', { userId: toId })
            io.emit('userBusyRace', { userId: fromId })
            console.log(`🏎️ Race room ${roomId} created for ${toId} vs ${fromId}`)
        })

        socket.on('declineRaceChallenge', async ({ from, to }) => {
            const toId = normalizeUserId(to) || to
            const toData = await getUserSocket(toId)
            if (toData?.socketId) {
                io.to(toData.socketId).emit('raceDeclined')
            }
        })

        // Join a race room — called by the game component when it mounts
        // (the React app's main socket already joined via acceptRaceChallenge, but the
        //  game page re-joins to guarantee membership and signal readiness)
        socket.on('joinRaceRoom', ({ roomId }) => {
            if (!roomId) return
            socket.join(roomId)
            console.log(`🏎️ Socket ${socket.id} joined race room ${roomId}`)
            // Count live sockets in this room
            const roomSockets = io.sockets.adapter.rooms.get(roomId)
            const count = roomSockets ? roomSockets.size : 0
            // Notify everyone in the room (including sender) how many have joined
            io.to(roomId).emit('racePlayerJoined', { count })
        })

        // Recover active race room after refresh/reconnect (Chess-like firmness).
        socket.on('recoverRaceGame', async () => {
            try {
                const uid = normalizeUserId(socket.handshake.query.userId)
                if (!uid) return socket.emit('raceGameRecovery', { ok: false })
                const roomId = await getActiveRaceGame(uid)
                if (!roomId) return socket.emit('raceGameRecovery', { ok: false })
                const state = await getRaceGameState(roomId).catch(() => null)
                if (!state) return socket.emit('raceGameRecovery', { ok: false })
                const p1 = normalizeUserId(state.player1) || state.player1
                const p2 = normalizeUserId(state.player2) || state.player2
                const opponentId = p1 === uid ? p2 : p1
                socket.join(roomId)
                socket.emit('raceGameRecovery', { ok: true, roomId, opponentId, isHost: p1 === uid })
            } catch (e) {
                socket.emit('raceGameRecovery', { ok: false })
            }
        })

        // Explicit room leave (route navigation / cleanup) so stale room membership
        // cannot keep opponents "stuck in race" when someone goes Home.
        socket.on('leaveRaceRoom', ({ roomId }) => {
            if (!roomId) return
            socket.leave(roomId)
            const roomSockets = io.sockets.adapter.rooms.get(roomId)
            const count = roomSockets ? roomSockets.size : 0
            io.to(roomId).emit('racePlayerJoined', { count })
            console.log(`🏎️ Socket ${socket.id} left race room ${roomId} (remaining: ${count})`)
        })

        // Player finished loading race assets and is ready to start.
        socket.on('racePlayerReady', async ({ roomId, userId }) => {
            if (!roomId) return
            const uid = normalizeUserId(userId || socket.handshake.query.userId)
            if (!uid) return
            const state = await getRaceGameState(roomId).catch(() => null)
            if (!state) return
            const p1 = normalizeUserId(state.player1) || state.player1
            const p2 = normalizeUserId(state.player2) || state.player2
            if (uid !== p1 && uid !== p2) return

            const ready = Array.isArray(state.readyPlayers) ? state.readyPlayers.map((x) => normalizeUserId(x) || x) : []
            if (!ready.includes(uid)) ready.push(uid)
            state.readyPlayers = ready
            await setRaceGameState(roomId, state).catch(() => {})

            const bothReady = !!p1 && !!p2 && ready.includes(p1) && ready.includes(p2)
            io.to(roomId).emit('raceReadyState', {
                roomId,
                readyPlayers: ready,
                readyCount: ready.length,
                bothReady,
            })
            if (bothReady) {
                io.to(roomId).emit('raceBothReady', { roomId })
            }
        })

        // Host signals countdown start — relay to the rest of the room (guest)
        socket.on('raceCountdownStart', ({ roomId }) => {
            if (!roomId) return
            socket.to(roomId).emit('raceCountdownStart')
        })

        // Race voice invite flow (separate from global call UI):
        // caller -> invite -> opponent accepts/declines -> both connect dedicated race voice.
        socket.on('raceVoiceInvite', async ({ roomId }) => {
            try {
                if (!roomId) return
                const state = await getRaceGameState(roomId).catch(() => null)
                if (!state) return
                const senderId = normalizeUserId(socket.handshake.query.userId)
                const p1 = normalizeUserId(state.player1) || state.player1
                const p2 = normalizeUserId(state.player2) || state.player2
                if (!senderId || (senderId !== p1 && senderId !== p2)) return
                const targetId = senderId === p1 ? p2 : p1
                if (!targetId) return
                const senderUser = await User.findById(senderId).select('name username profilePic').lean().catch(() => null)
                const targetData = await getUserSocket(targetId).catch(() => null)
                if (targetData?.socketId) {
                    io.to(targetData.socketId).emit('raceVoiceInvite', {
                        roomId,
                        from: senderId,
                        callerName: senderUser?.name || senderUser?.username || 'Opponent',
                        callerProfilePic: senderUser?.profilePic || '',
                    })
                }
            } catch (err) {
                console.error('❌ [raceVoiceInvite]', err.message)
            }
        })

        socket.on('raceVoiceAccepted', async ({ roomId }) => {
            try {
                if (!roomId) return
                const state = await getRaceGameState(roomId).catch(() => null)
                if (!state) return
                const senderId = normalizeUserId(socket.handshake.query.userId)
                const p1 = normalizeUserId(state.player1) || state.player1
                const p2 = normalizeUserId(state.player2) || state.player2
                if (!senderId || (senderId !== p1 && senderId !== p2)) return
                io.to(roomId).emit('raceVoiceAccepted', { roomId, by: senderId })
            } catch (err) {
                console.error('❌ [raceVoiceAccepted]', err.message)
            }
        })

        socket.on('raceVoiceDeclined', async ({ roomId }) => {
            try {
                if (!roomId) return
                const state = await getRaceGameState(roomId).catch(() => null)
                if (!state) return
                const senderId = normalizeUserId(socket.handshake.query.userId)
                const p1 = normalizeUserId(state.player1) || state.player1
                const p2 = normalizeUserId(state.player2) || state.player2
                if (!senderId || (senderId !== p1 && senderId !== p2)) return
                io.to(roomId).emit('raceVoiceDeclined', { roomId, by: senderId })
            } catch (err) {
                console.error('❌ [raceVoiceDeclined]', err.message)
            }
        })

        socket.on('raceVoiceEnd', async ({ roomId }) => {
            try {
                if (!roomId) return
                const state = await getRaceGameState(roomId).catch(() => null)
                if (!state) return
                const senderId = normalizeUserId(socket.handshake.query.userId)
                const p1 = normalizeUserId(state.player1) || state.player1
                const p2 = normalizeUserId(state.player2) || state.player2
                if (!senderId || (senderId !== p1 && senderId !== p2)) return
                io.to(roomId).emit('raceVoiceEnded', { roomId, by: senderId })
            } catch (err) {
                console.error('❌ [raceVoiceEnd]', err.message)
            }
        })

        // Position relay — server-side rate limit: max 20 updates/sec per socket
        // Prevents buggy/malicious clients from flooding opponents
        const racePosLastSent = new Map()
        const RACE_POS_MIN_INTERVAL_MS = 50 // 20 Hz max
        socket.on('racePosUpdate', ({ roomId, ...posData }) => {
            if (!roomId) return
            const now = Date.now()
            const last = racePosLastSent.get(roomId) || 0
            if (now - last < RACE_POS_MIN_INTERVAL_MS) return
            racePosLastSent.set(roomId, now)
            socket.to(roomId).emit('raceOpponentPos', posData)
        })

        socket.on('raceFinished', async ({ roomId, winnerId, time }) => {
            // Broadcast to the socket room
            io.to(roomId).emit('raceResult', { winnerId, time })
            // Also notify both players directly by userId (fallback if one hasn't joined the room yet)
            const state = await getRaceGameState(roomId).catch(() => null)
            if (state) {
                const id1 = normalizeUserId(state.player1) || state.player1
                const id2 = normalizeUserId(state.player2) || state.player2
                const [p1Data, p2Data] = await Promise.all([
                    getUserSocket(id1).catch(() => null),
                    getUserSocket(id2).catch(() => null),
                ])
                if (p1Data?.socketId) io.to(p1Data.socketId).emit('raceResult', { winnerId, time })
                if (p2Data?.socketId) io.to(p2Data.socketId).emit('raceResult', { winnerId, time })
                // Clear Redis immediately so new challenges work (15s delay left users "busy" for no reason)
                io.emit('userAvailableRace', { userId: id1 })
                io.emit('userAvailableRace', { userId: id2 })
                await deleteActiveRaceGame(id1).catch(() => {})
                await deleteActiveRaceGame(id2).catch(() => {})
                await deleteRaceGameState(roomId).catch(() => {})
            }
        })

        socket.on('raceGameEnd', async ({ roomId, player1, player2 }) => {
            const st = await getRaceGameState(roomId).catch(() => null)
            // Client may send only { roomId } (e.g. beforeunload regex mismatch) — always resolve players from Redis
            let p1 = normalizeUserId(player1) || player1
            let p2 = normalizeUserId(player2) || player2
            if (st) {
                if (!p1) p1 = normalizeUserId(st.player1) || st.player1
                if (!p2) p2 = normalizeUserId(st.player2) || st.player2
            }
            console.log(`🏎️ Race ended (navigation/quit): room ${roomId}`)

            // 1. Broadcast to anyone already in the socket room
            socket.to(roomId).emit('raceOpponentLeft')

            // 2. Also notify the opponent directly by userId —
            //    guarantees delivery even if they haven't called joinRaceRoom yet
            const senderNorm = normalizeUserId(socket.handshake.query.userId)
            let otherPlayerId = null
            if (p1 && p2) {
                otherPlayerId = senderNorm === p1 ? p2 : p1
            }
            if (!otherPlayerId && st) {
                const sp1 = normalizeUserId(st.player1) || st.player1
                const sp2 = normalizeUserId(st.player2) || st.player2
                otherPlayerId = senderNorm === sp1 ? sp2 : sp1
            }
            if (otherPlayerId) {
                const otherData = await getUserSocket(otherPlayerId).catch(() => null)
                if (otherData?.socketId) {
                    io.to(otherData.socketId).emit('raceOpponentLeft')
                }
            }

            // 3. Mark both players available again (must run even when payload omitted player ids)
            if (p1) io.emit('userAvailableRace', { userId: p1 })
            if (p2) io.emit('userAvailableRace', { userId: p2 })

            // 4. Cleanup Redis (only delete when we have real ids — avoids activeRaceGame:undefined)
            if (p1) await deleteActiveRaceGame(p1).catch(() => {})
            if (p2) await deleteActiveRaceGame(p2).catch(() => {})
            await deleteRaceGameState(roomId).catch(() => {})
            // Force all sockets out of this room so stale memberships never keep ghost races alive.
            try { io.in(roomId).socketsLeave(roomId) } catch (_) {}
        })

        // Card Game Challenge Events (Same pattern as Chess)
        socket.on("cardChallenge", async ({ from, to, fromName, fromUsername, fromProfilePic }) => {
            const fromId = normalizeUserId(from) || from
            const toId = normalizeUserId(to) || to
            console.log(`🃏 Card challenge from ${fromId} to ${toId}`)
            if (await isBlockedForGameChallenge(fromId) || await isBlockedForGameChallenge(toId)) {
                const senderSock = await getUserSocket(fromId)
                if (senderSock?.socketId) {
                    io.to(senderSock.socketId).emit('gameChallengeBlocked', { game: 'card', to: toId })
                }
                console.warn(`🃏 [cardChallenge] Blocked (call or active game)`, { fromId, toId })
                return
            }
            const recipientData = await getUserSocket(toId)
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("cardChallenge", {
                    from: fromId,
                    to: toId,
                    fromName,
                    fromUsername,
                    fromProfilePic
                })
            } else {
                console.warn(`⚠️ [cardChallenge] No socket for recipient ${toId} — challenge not delivered`)
            }
        })

        socket.on("acceptCardChallenge", async ({ from, to, roomId }) => {
            const fromId = normalizeUserId(from) || from
            const toId = normalizeUserId(to) || to
            console.log(`🃏 Card challenge accepted: ${roomId}`)
            console.log(`🃏 Challenger (to): ${toId}`)
            console.log(`🃏 Accepter (from): ${fromId}`)

            const challengerSock = await getUserSocket(toId)
            const challengerSocketId = challengerSock?.socketId
            const accepterSock = await getUserSocket(fromId)
            const accepterSocketId = accepterSock?.socketId

            if (roomId) {
                await setActiveCardGame(toId, roomId)
                await setActiveCardGame(fromId, roomId)

                if (challengerSocketId) {
                    const challengerSocket = io.sockets.sockets.get(challengerSocketId)
                    if (challengerSocket) {
                        challengerSocket.join(roomId)
                        console.log(`🃏 Challenger ${toId} joined room: ${roomId}`)
                    }
                }
                if (accepterSocketId) {
                    const accepterSocket = io.sockets.sockets.get(accepterSocketId)
                    if (accepterSocket) {
                        accepterSocket.join(roomId)
                        console.log(`🃏 Accepter ${fromId} joined room: ${roomId}`)
                    }
                }
                console.log(`🃏 Created card game room: ${roomId} with both players`)
            }

            // Same reasoning as chess: don't use io.sockets.sockets.get() to decide whether to emit.
            // Only queue when the socketId is missing from userSocketMap.
            // Make it robust by always writing pending payload for both users.
            // If the live emit is missed (disconnect/reconnect timing), the next socket connect will deliver.
            if (toId) await setPendingCardAcceptForUser(toId, { roomId, opponentId: fromId })
            if (fromId) await setPendingCardAcceptForUser(fromId, { roomId, opponentId: toId })
            if (challengerSocketId) {
                const payload = { roomId, opponentId: fromId }
                io.to(challengerSocketId).emit('acceptCardChallenge', payload)
            } else {
                console.log(`⚠️ Challenger ${toId} not in socket map — live accept emit skipped (pending already written)`)
            }

            if (accepterSocketId) {
                const payload = { roomId, opponentId: toId }
                io.to(accepterSocketId).emit('acceptCardChallenge', payload)
            } else {
                console.log(`⚠️ Accepter ${fromId} not in socket map — live accept emit skipped (pending already written)`)
            }

            let gameState = null
            if (roomId) {
                const { initializeGoFishGame } = await import('../utils/goFishGame.js')
                gameState = initializeGoFishGame(toId, fromId)

                await setCardGameState(roomId, gameState)
                console.log(`💾 Initialized Go Fish game state for room ${roomId} in Redis`)
                console.log(
                    `🃏 Player 1 (${toId}) score: ${gameState.players[0].score}, Player 2 (${fromId}) score: ${gameState.players[1].score}`
                )
            }

            io.emit('userBusyCard', { userId: fromId })
            io.emit('userBusyCard', { userId: toId })

            if (roomId && gameState) {
                console.log(`🃏 [acceptCardChallenge] Game state initialized:`, {
                    player1Id: gameState.players[0]?.userId,
                    player1HandLength: gameState.players[0]?.hand?.length || 0,
                    player2Id: gameState.players[1]?.userId,
                    player2HandLength: gameState.players[1]?.hand?.length || 0,
                    challengerId: toId,
                    accepterId: fromId,
                    turn: gameState.turn,
                })

                if (challengerSocketId) {
                    const challengerState = buildCardGameStatePayloadForViewer(gameState, roomId, toId)
                    io.to(challengerSocketId).emit('cardGameState', challengerState)
                    console.log(`📤 Sent initial game state to challenger ${toId}`)
                }

                if (accepterSocketId) {
                    const accepterState = buildCardGameStatePayloadForViewer(gameState, roomId, fromId)
                    io.to(accepterSocketId).emit('cardGameState', accepterState)
                    console.log(`📤 Sent initial game state to accepter ${fromId}`)
                }
            }

            setTimeout(() => {
                createCardGamePost(toId, fromId, roomId).catch((err) => {
                    console.error('❌ [socket] Error creating card game post:', err)
                })
            }, 500)
        })

        socket.on("declineCardChallenge", async ({ from, to }) => {
            const fromId = normalizeUserId(from) || from
            const toId = normalizeUserId(to) || to
            console.log(`🃏 Card challenge declined by ${fromId}`)
            await deletePendingCardAcceptForUser(fromId).catch(() => {})
            await deletePendingCardAcceptForUser(toId).catch(() => {})
            const challengerData = await getUserSocket(toId)
            const challengerSocketId = challengerData?.socketId
            if (challengerSocketId) {
                io.to(challengerSocketId).emit("cardDeclined", { from: fromId })
            }
        })

        // Join card room for spectators
        socket.on("joinCardRoom", async ({ roomId, userId }) => {
            if (roomId) {
                // CRITICAL: Leave all other card rooms first
                const socketRooms = Array.from(socket.rooms)
                for (const currentRoom of socketRooms) {
                    if (currentRoom.startsWith('card_') && currentRoom !== roomId) {
                        console.log(`🃏 [joinCardRoom] Leaving old card room: ${currentRoom} (socket: ${socket.id})`)
                        socket.leave(currentRoom)
                    }
                }
                
                // Join the Socket.IO room
                socket.join(roomId)
                console.log(`🃏 User joined card room: ${roomId} (socket: ${socket.id})`)
                
                // Send current game state when joining (for catch-up)
                const gameState = await getCardGameState(roomId)
                
                if (gameState) {
                    const userId = socket.handshake.query.userId
                    const playerIndex = gameState.players.findIndex((p) => p.userId === userId)
                    
                    console.log(`📤 Sending card game state to user for catch-up:`, {
                        roomId,
                        gameStatus: gameState.gameStatus,
                        turn: gameState.turn,
                        playerIndex,
                        lastUpdated: new Date(gameState.lastUpdated).toISOString()
                    })
                    
                    // Send state with player's own hand (private) and opponent's hand count only
                    const publicState = {
                        roomId,
                        players: gameState.players.map((p, index) => {
                            if (index === playerIndex) {
                                // Send full hand to the player (their own cards)
                                return {
                                    userId: p.userId,
                                    hand: p.hand, // Private - only for this player
                                    score: p.score,
                                    books: p.books || []
                                }
                            } else {
                                // Send only count for opponent (privacy)
                                return {
                                    userId: p.userId,
                                    handCount: p.hand?.length || 0,
                                    score: p.score,
                                    books: p.books || []
                                }
                            }
                        }),
                        deckCount: gameState.deck?.length || 0,
                        table: gameState.table,
                        turn: gameState.turn,
                        gameStatus: gameState.gameStatus,
                        winner: gameState.winner,
                        lastMove: gameState.lastMove
                    }
                    io.to(socket.id).emit("cardGameState", publicState)
                } else {
                    console.log(`⚠️ No game state found for room ${roomId}`)
                }
            }
        })

        // Recover active card room after refresh/reconnect (Chess-like firmness).
        socket.on("recoverCardGame", async () => {
            try {
                const uid = normalizeUserId(socket.handshake.query.userId)
                if (!uid) return socket.emit('cardGameRecovery', { ok: false })
                const roomId = await getActiveCardGame(uid)
                if (!roomId) return socket.emit('cardGameRecovery', { ok: false })
                socket.join(roomId)

                const gameState = await getCardGameState(roomId).catch(() => null)
                let opponentId = null
                if (gameState?.players?.length) {
                    const p1 = normalizeUserId(gameState.players[0]?.userId) || gameState.players[0]?.userId
                    const p2 = normalizeUserId(gameState.players[1]?.userId) || gameState.players[1]?.userId
                    opponentId = p1 === uid ? p2 : p1
                } else {
                    const m = roomId.match(/^card_(.+?)_(.+?)_\d+$/)
                    if (m) {
                        const p1 = normalizeUserId(m[1]) || m[1]
                        const p2 = normalizeUserId(m[2]) || m[2]
                        opponentId = p1 === uid ? p2 : p1
                    }
                }

                socket.emit('cardGameRecovery', { ok: true, roomId, opponentId })

                if (gameState) {
                    const payload = buildCardGameStatePayloadForViewer(gameState, roomId, uid)
                    io.to(socket.id).emit('cardGameState', payload)
                }
            } catch (e) {
                socket.emit('cardGameRecovery', { ok: false })
            }
        })

        socket.on("cardMove", async ({ roomId, move, to }) => {
            console.log(`🃏 Card move received from ${socket.handshake.query.userId} to ${to}`)
            console.log(`🃏 Move data:`, move)
            
            // Update game state in backend (for spectator catch-up) - Redis
            if (roomId) {
                const currentState = await getCardGameState(roomId)
                if (currentState) {
                    const userId = socket.handshake.query.userId
                    const playerIndex = currentState.players.findIndex((p) => p.userId === userId)
                    
                    if (playerIndex === -1) {
                        console.error(`❌ [cardMove] Player ${userId} not found in game state`)
                        return
                    }
                    
                    // Validate it's player's turn
                    if (currentState.turn !== playerIndex) {
                        console.warn(`⚠️ [cardMove] Not player's turn. Current turn: ${currentState.turn}, Player index: ${playerIndex}`)
                        return
                    }
                    
                    try {
                        const { processAskMove, checkGameOver } = await import('../utils/goFishGame.js')
                        
                        // Process Go Fish "ask" move
                        if (move.action === 'ask' && move.rank) {
                            const result = processAskMove(currentState, playerIndex, move.rank)
                            
                            // Update turn
                            currentState.turn = result.nextTurn
                            currentState.lastMove = {
                                playerId: userId,
                                action: 'ask',
                                rank: move.rank,
                                gotCards: result.gotCards,
                                cardsReceived: result.cardsReceived || 0,
                                newBooks: result.newBooks || 0,
                                timestamp: Date.now()
                            }
                            
                            // Check for game over
                            const gameOverCheck = checkGameOver(currentState)
                            if (gameOverCheck.gameOver) {
                                currentState.gameStatus = 'finished'
                                currentState.winner = gameOverCheck.winner
                            }
                            
                            currentState.lastUpdated = Date.now()
                            
                            await setCardGameState(roomId, currentState)
                            console.log(`💾 Updated Go Fish game state for room ${roomId}`)
                            console.log(`🃏 Scores: P1=${currentState.players[0].score}, P2=${currentState.players[1].score}`)
                            
                            // If game over, emit game end event
                            if (gameOverCheck.gameOver) {
                                const player1Data = await getUserSocket(currentState.players[0].userId)
                                const player2Data = await getUserSocket(currentState.players[1].userId)
                                const player1SocketId = player1Data?.socketId
                                const player2SocketId = player2Data?.socketId
                                
                                const winnerName = gameOverCheck.winner === currentState.players[0].userId 
                                    ? 'Player 1' 
                                    : gameOverCheck.winner === currentState.players[1].userId 
                                    ? 'Player 2' 
                                    : 'Tie'
                                
                                const endMessage = gameOverCheck.winner 
                                    ? `${winnerName} wins! (${gameOverCheck.scores.player1} - ${gameOverCheck.scores.player2})`
                                    : `Tie game! (${gameOverCheck.scores.player1} - ${gameOverCheck.scores.player2})`
                                
                                if (player1SocketId) {
                                    io.to(player1SocketId).emit("cardGameEnded", { 
                                        roomId,
                                        reason: 'finished',
                                        message: endMessage
                                    })
                                }
                                if (player2SocketId) {
                                    io.to(player2SocketId).emit("cardGameEnded", { 
                                        roomId,
                                        reason: 'finished',
                                        message: endMessage
                                    })
                                }
                                
                                // Notify spectators
                                const room = io.sockets.adapter.rooms.get(roomId)
                                if (room && room.size > 0) {
                                    io.to(roomId).emit("cardGameEnded", { 
                                        reason: 'finished',
                                        message: endMessage
                                    })
                                }
                                
                                // Delete card game post
                                deleteCardGamePost(roomId).catch(err => {
                                    console.error('❌ Error deleting card game post:', err)
                                })
                                
                                // Clean up Redis
                                await deleteActiveCardGame(currentState.players[0].userId)
                                await deleteActiveCardGame(currentState.players[1].userId)
                                await deletePendingCardAcceptForUser(currentState.players[0].userId).catch(() => {})
                                await deletePendingCardAcceptForUser(currentState.players[1].userId).catch(() => {})
                                await deleteCardGameState(roomId)
                                
                                // Make users available
                                io.emit("userAvailableCard", { userId: currentState.players[0].userId })
                                io.emit("userAvailableCard", { userId: currentState.players[1].userId })
                            }
                        }
                    } catch (error) {
                        console.error(`❌ [cardMove] Error processing move:`, error)
                        // Don't update state if move is invalid
                        return
                    }
                }
            }
            
            // Emit to the opponent (specific user)
            const recipientData = await getUserSocket(to)
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                console.log(`🃏 Forwarding move to ${to} (socket: ${recipientSocketId})`)
                io.to(recipientSocketId).emit("opponentMove", { move, roomId })
            } else {
                console.log(`⚠️ Recipient ${to} not found in socket map`)
            }
            
            // ALSO emit to all spectators in the room
            if (roomId) {
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    console.log(`👁️ Broadcasting move to ${room.size} sockets in room ${roomId}`)
                    io.to(roomId).emit("opponentMove", { move, roomId })
                }
            }
        })

        socket.on("resignCard", async ({ roomId, to }) => {
            // Fallback: if "to" is missing, derive opponent from roomId (card_player1_player2_timestamp)
            let opponentId = to
            const userId = socket.handshake.query.userId
            if (!opponentId && roomId && roomId.startsWith('card_')) {
                const parts = roomId.split('_')
                if (parts.length >= 3) {
                    const p1 = parts[1]
                    const p2 = parts[2]
                    opponentId = (p1?.toString?.() === userId?.toString?.()) ? p2 : p1
                }
            }

            const recipientData = opponentId ? await getUserSocket(opponentId) : null
            const recipientSocketId = recipientData?.socketId
            const resignerData = await getUserSocket(socket.handshake.query.userId)
            const resignerSocketId = resignerData?.socketId
            
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("opponentResigned")
            }
            
            // Emit cleanup event to both players
            if (resignerSocketId) {
                io.to(resignerSocketId).emit("cardGameCleanup")
            }
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("cardGameCleanup")
            }
            
            // Notify all spectators in the room that game ended
            if (roomId) {
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    console.log(`👁️ Notifying ${room.size} spectators that game ended (resign)`)
                    io.to(roomId).emit("cardGameEnded", { reason: 'resigned' })
                }
            }
            
            // Delete card game post immediately
            if (roomId) {
                deleteCardGamePost(roomId).catch(err => {
                    console.error('❌ Error deleting card game post on resign:', err)
                })
                // Remove from active games tracking (Redis)
                await deleteActiveCardGame(userId)
                if (opponentId) {
                    await deleteActiveCardGame(opponentId)
                }
                await deletePendingCardAcceptForUser(userId).catch(() => {})
                if (opponentId) await deletePendingCardAcceptForUser(opponentId).catch(() => {})
                // Clean up game state (Redis)
                await deleteCardGameState(roomId)
                console.log(`🗑️ Cleaned up card game state for room ${roomId}`)
            }
            
            // Make users available again (always emit, even if resigner disconnected)
            io.emit("userAvailableCard", { userId })
            if (opponentId) {
                io.emit("userAvailableCard", { userId: opponentId })
                console.log(`✅ [resignCard] Made users available: ${userId} and ${opponentId}`)
            } else {
                console.log(`⚠️ [resignCard] Made user available but opponentId missing: ${userId}`)
            }
        })

        socket.on("cardGameEnd", async ({ roomId, player1, player2, reason }) => {
            const currentUserId = socket.handshake.query.userId
            const player1Data = await getUserSocket(player1)
            const player1SocketId = player1Data?.socketId
            const player2Data = await getUserSocket(player2)
            const player2SocketId = player2Data?.socketId
            
            // If game ended normally, notify both players
            if (reason === 'game_over' || reason === 'finished') {
                if (player1SocketId) {
                    io.to(player1SocketId).emit("cardGameCleanup")
                }
                if (player2SocketId) {
                    io.to(player2SocketId).emit("cardGameCleanup")
                }
            } else {
                // Player left - notify the other player
                const otherPlayerId = currentUserId === player1 ? player2 : player1
                const otherPlayerSocketId = currentUserId === player1 ? player2SocketId : player1SocketId
                
                if (otherPlayerSocketId) {
                    io.to(otherPlayerSocketId).emit("opponentLeftGame")
                    io.to(otherPlayerSocketId).emit("cardGameCleanup")
                }
            }
            
            // Notify all spectators in the room that game ended
            if (roomId) {
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    const endReason = reason || 'player_left'
                    console.log(`👁️ Notifying ${room.size} spectators that game ended (${endReason})`)
                    io.to(roomId).emit("cardGameEnded", { reason: endReason })
                }
            }
            
            // Delete card game post immediately
            if (roomId) {
                deleteCardGamePost(roomId).catch(err => {
                    console.error('❌ Error deleting card game post on game end:', err)
                })
                // Remove from active games tracking (Redis)
                await deleteActiveCardGame(player1)
                await deleteActiveCardGame(player2)
                await deletePendingCardAcceptForUser(player1).catch(() => {})
                await deletePendingCardAcceptForUser(player2).catch(() => {})
                // Clean up game state (Redis)
                await deleteCardGameState(roomId)
                console.log(`🗑️ Cleaned up card game state for room ${roomId}`)
            }
            
            // Make users available again
            if (player1SocketId) {
                io.emit("userAvailableCard", { userId: player1 })
                io.emit("userAvailableCard", { userId: player2 })
            }
        })

        socket.on("requestCardGameState", async ({ roomId }) => {
            if (roomId) {
                const gameState = await getCardGameState(roomId)
                if (gameState && gameState.players && gameState.players.length > 0) {
                    const userId = socket.handshake.query.userId
                    const playerIndex = gameState.players.findIndex((p) => {
                        const pId = p.userId?.toString()
                        const uId = userId?.toString()
                        return pId === uId
                    })
                    
                    console.log(`📤 [requestCardGameState] Processing request for ${userId}`, {
                        roomId,
                        playerIndex,
                        gameStatePlayers: gameState.players.map((p, idx) => ({
                            index: idx,
                            userId: p.userId?.toString(),
                            handLength: p.hand?.length || 0
                        }))
                    })
                    
                    if (playerIndex >= 0) {
                        // Send state with player's own hand (private) and opponent's hand count only
                        const publicState = {
                            roomId,
                            players: gameState.players.map((p, index) => {
                                if (index === playerIndex) {
                                    // Send full hand to the player (their own cards)
                                    return {
                                        userId: p.userId,
                                        hand: p.hand || [],
                                        score: p.score,
                                        books: p.books || []
                                    }
                                } else {
                                    // Send only count for opponent (privacy)
                                    return {
                                        userId: p.userId,
                                        handCount: p.hand?.length || 0,
                                        score: p.score,
                                        books: p.books || []
                                    }
                                }
                            }),
                            deckCount: gameState.deck?.length || 0,
                            table: gameState.table,
                            turn: gameState.turn,
                            gameStatus: gameState.gameStatus,
                            winner: gameState.winner,
                            lastMove: gameState.lastMove
                        }
                        io.to(socket.id).emit("cardGameState", publicState)
                        console.log(`📤 [requestCardGameState] Sent game state to ${userId}`, {
                            playerIndex,
                            handLength: gameState.players[playerIndex]?.hand?.length || 0,
                            sentHandLength: publicState.players[playerIndex]?.hand?.length || 0
                        })
                    } else {
                        console.warn(`⚠️ [requestCardGameState] Player ${userId} not found in game state`, {
                            roomId,
                            gameStatePlayers: gameState.players.map((p) => p.userId?.toString())
                        })
                    }
                } else {
                    console.log(`⚠️ [requestCardGameState] No game state found for room ${roomId}`)
                }
            }
        })

        socket.on("disconnect", async () => {
            console.log("user disconnected", socket.id)
            
            let disconnectedUserId = null
            
            // O(1) lookup by reverse mapping (fallback to scan for safety)
            const mappedUserId = await getSocketUser(socket.id)
            if (mappedUserId) {
                // Always remove reverse mapping for this exact socket id.
                await deleteSocketUser(socket.id)

                // Guard against stale-disconnect race:
                // if user already reconnected on a newer socket, do NOT wipe their live mapping/presence.
                const currentUserSocket = await getUserSocket(mappedUserId)
                const currentSocketId = currentUserSocket?.socketId
                if (currentSocketId && currentSocketId !== socket.id) {
                    console.log(
                        `⏭️ [socket] Ignoring stale disconnect for user ${mappedUserId}: old=${socket.id}, current=${currentSocketId}`
                    )
                } else {
                    disconnectedUserId = mappedUserId
                    await deleteUserSocket(mappedUserId) // Delete from both in-memory and Redis
                    await deleteUserPresence(mappedUserId).catch(() => {})
                }
            } else {
                const allSockets = await getAllUserSockets()
                for (const [id, data] of Object.entries(allSockets)) {
                    if (data.socketId === socket.id) {
                        disconnectedUserId = id
                        await deleteUserSocket(id)
                        await deleteUserPresence(id).catch(() => {})
                        break
                    }
                }
            }

            // Emit targeted presence update for this userId (for subscribed clients)
            try {
                const normalized = normalizeUserId(disconnectedUserId)
                if (normalized) {
                    io.to(`${PRESENCE_ROOM_PREFIX}${normalized}`).emit('presenceUpdate', {
                        userId: normalized,
                        online: false,
                    })
                }
            } catch (e) {
                console.error('❌ [socket] Failed to emit presenceUpdate (offline):', e.message)
            }

            // LiveKit broadcast: streamer closed tab / lost socket without `livekit:endLive` — clear Mongo + notify after grace (reconnect cancels).
            if (disconnectedUserId) {
                const lsUid = normalizeUserId(disconnectedUserId)
                if (lsUid) {
                    const prevLs = liveStreamDisconnectTimers.get(lsUid)
                    if (prevLs) clearTimeout(prevLs)
                    liveStreamDisconnectTimers.set(
                        lsUid,
                        setTimeout(async () => {
                            liveStreamDisconnectTimers.delete(lsUid)
                            try {
                                const sock = await getUserSocket(lsUid)
                                if (sock?.socketId) return
                                const active = await LiveStream.findOne({ streamer: lsUid }).lean()
                                if (!active) return
                                const roomNm = active.roomName || ''
                                safeClearTimer(livekitStreamTimers, lsUid)
                                await LiveStream.deleteMany({ streamer: lsUid })
                                const streamerNorm = normalizeUserId(lsUid) || String(lsUid)
                                const endPayload = { streamerId: streamerNorm, roomName: roomNm, reason: 'disconnect' }
                                const streamerDoc = await User.findById(lsUid).select('followers').lean()
                                if (streamerDoc?.followers?.length) {
                                    for (const followerId of streamerDoc.followers) {
                                        const fid = normalizeUserId(followerId) || String(followerId)
                                        emitToUserSelf(fid, 'livekit:streamEnded', endPayload)
                                    }
                                }
                                emitToUserSelf(streamerNorm, 'livekit:streamEnded', endPayload)
                                console.log(
                                    `⬛ [LiveKit] Live stream cleaned up after socket loss (${LIVE_STREAM_DISCONNECT_GRACE_MS}ms) — streamer:${lsUid}`
                                )
                            } catch (e) {
                                console.error('❌ [LiveKit] live stream disconnect cleanup failed:', e?.message)
                            }
                        }, LIVE_STREAM_DISCONNECT_GRACE_MS)
                    )
                }
            }

            // Call teardown on disconnect: wait for reconnect (ringing / WebRTC churn) before clearing Redis + FCM.
            if (disconnectedUserId) {
                const inCallData = await getInCall(disconnectedUserId)
                const callId = inCallData?.callId
                if (callId) {
                    const uid = normalizeUserId(disconnectedUserId)
                    const prevTimer = callDisconnectGraceTimers.get(uid)
                    if (prevTimer) clearTimeout(prevTimer)

                    callDisconnectGraceTimers.set(
                        uid,
                        setTimeout(async () => {
                            callDisconnectGraceTimers.delete(uid)
                            try {
                                const stillIn = await getInCall(uid)
                                if (!stillIn?.callId || stillIn.callId !== callId) return

                                const sock = await getUserSocket(uid)
                                if (sock?.socketId) {
                                    console.log(`✅ [disconnect-call] User ${uid} reconnected within grace — skipping call teardown`)
                                    return
                                }

                                let otherUserId = null
                                const callData = await getActiveCall(callId)
                                if (callData) {
                                    const u1 = normalizeUserId(callData.user1)
                                    const u2 = normalizeUserId(callData.user2)
                                    if (u1 === uid) otherUserId = u2
                                    else if (u2 === uid) otherUserId = u1
                                }
                                if (!otherUserId) otherUserId = getPeerUserIdFromCompositeCallId(callId, uid)

                                await clearCallStateForPair(uid, otherUserId || '')
                                if (otherUserId) {
                                    const otherUserData = await getUserSocket(otherUserId)
                                    if (otherUserData?.socketId) {
                                        io.to(otherUserData.socketId).emit('CallCanceled')
                                        io.emit('cancleCall', { userToCall: otherUserId, from: uid })
                                    }
                                    try {
                                        const { sendCallEndedNotificationToUser } = await import('../services/fcmNotifications.js')
                                        const fcmResult = await sendCallEndedNotificationToUser(otherUserId, uid)
                                        if (fcmResult.success) console.log('✅ [disconnect-call] Sent call ended FCM to:', otherUserId)
                                    } catch (fcmErr) {
                                        console.error('❌ [disconnect-call] FCM call ended:', fcmErr?.message)
                                    }
                                }
                            } catch (e) {
                                console.error('❌ [disconnect-call] grace handler failed:', e?.message)
                            }
                        }, CALL_DISCONNECT_GRACE_MS)
                    )
                }
            }

            // Check if disconnected user was in an active chess game
            // IMPORTANT: Don't end game immediately - wait to see if user reconnects (page refresh scenario)
            // Only end game if user doesn't reconnect within 10 seconds
            if (disconnectedUserId && await hasActiveChessGame(disconnectedUserId)) {
                const gameRoomId = await getActiveChessGame(disconnectedUserId)
                console.log(`♟️ User ${disconnectedUserId} disconnected while in game: ${gameRoomId}`)
                console.log(`⏳ Waiting 10 seconds to see if user reconnects (page refresh)...`)

                // Parse other player directly from roomId (chess_p1_p2_ts) — works on any server instance
                let otherPlayerId = null
                const chessRoomMatch = gameRoomId && gameRoomId.match(/^chess_(.+?)_(.+?)_\d+$/)
                if (chessRoomMatch) {
                    const p1 = normalizeUserId(chessRoomMatch[1]) || chessRoomMatch[1]
                    const p2 = normalizeUserId(chessRoomMatch[2]) || chessRoomMatch[2]
                    otherPlayerId = p1 === disconnectedUserId ? p2 : p1
                }
                // Fallback: search in-memory cache (single-server only)
                if (!otherPlayerId) {
                    for (const [userId, roomId] of activeChessGames.entries()) {
                        if (roomId === gameRoomId && userId !== disconnectedUserId) {
                            otherPlayerId = userId
                            break
                        }
                    }
                }
                
                // Wait 10 seconds before ending the game (allows time for page refresh reconnect)
                setTimeout(async () => {
                    // Check if user reconnected (has active game and socket)
                    const stillInGame = await hasActiveChessGame(disconnectedUserId)
                    const reconnectedSocket = await getUserSocket(disconnectedUserId)
                    
                    if (stillInGame && reconnectedSocket) {
                        console.log(`✅ User ${disconnectedUserId} reconnected - game continues!`)
                        return // User reconnected, don't end the game
                    }
                    
                    // User didn't reconnect - end the game
                    console.log(`❌ User ${disconnectedUserId} did not reconnect - ending game`)
                    
                    // Notify the other player
                    if (otherPlayerId) {
                        const otherPlayerData = await getUserSocket(otherPlayerId)
                        const otherPlayerSocketId = otherPlayerData?.socketId
                        if (otherPlayerSocketId) {
                            io.to(otherPlayerSocketId).emit("opponentLeftGame")
                            io.to(otherPlayerSocketId).emit("chessGameCleanup")
                        }
                    }
                    
                    // Notify all spectators in the room
                    if (gameRoomId) {
                        const room = io.sockets.adapter.rooms.get(gameRoomId)
                        if (room && room.size > 0) {
                            console.log(`👁️ Notifying ${room.size} spectators that game ended (player disconnected)`)
                            io.to(gameRoomId).emit("chessGameEnded", { roomId: gameRoomId, reason: 'player_disconnected' })
                        }
                    }
                    
                    // Delete chess game post
                    deleteChessGamePost(gameRoomId).catch(err => {
                        console.error('❌ Error deleting chess game post on disconnect:', err)
                    })
                    
                    // Remove from active games tracking (Redis)
                    await deleteActiveChessGame(disconnectedUserId)
                    if (otherPlayerId) {
                        await deleteActiveChessGame(otherPlayerId)
                    }
                    await deletePendingChessAcceptForUser(disconnectedUserId).catch(() => {})
                    if (otherPlayerId) await deletePendingChessAcceptForUser(otherPlayerId).catch(() => {})
                    
                    // Clean up game state (Redis)
                    await deleteChessGameState(gameRoomId)
                    console.log(`🗑️ Cleaned up game state for room ${gameRoomId}`)
                }, 10000) // Wait 10 seconds before ending game
            }

            // ── 🏎️ Handle racing game disconnection ────────────────────────────────────
            if (disconnectedUserId && await hasActiveRaceGame(disconnectedUserId)) {
                const raceRoomId = await getActiveRaceGame(disconnectedUserId)
                console.log(`🏎️ User ${disconnectedUserId} disconnected during race: ${raceRoomId}`)
                setTimeout(async () => {
                    const stillInRace = await hasActiveRaceGame(disconnectedUserId)
                    const reconnected = await getUserSocket(disconnectedUserId)
                    if (stillInRace && reconnected?.socketId) {
                        // Harden against transient disconnects (e.g. media/call operations):
                        // if user is still marked active in race, force-join their current socket
                        // back into the race room and keep race alive.
                        try {
                            const liveSock = io.sockets.sockets.get(reconnected.socketId)
                            if (liveSock && raceRoomId) {
                                liveSock.join(raceRoomId)
                            }
                        } catch (_) {}
                        console.log(`✅ Racer ${disconnectedUserId} reconnected with active race state — race continues!`)
                        return
                    }
                    console.log(`❌ Racer ${disconnectedUserId} did not reconnect — ending race`)
                    const state = await getRaceGameState(raceRoomId)
                    let otherPlayerId = null
                    if (state) {
                        const sp1 = normalizeUserId(state.player1) || state.player1
                        const sp2 = normalizeUserId(state.player2) || state.player2
                        const dNorm = normalizeUserId(disconnectedUserId) || disconnectedUserId
                        otherPlayerId = sp1 === dNorm ? sp2 : sp1
                    }
                    // Fallback: parse race room id when state is missing (e.g. prior partial cleanup)
                    if (!otherPlayerId && raceRoomId && typeof raceRoomId === 'string') {
                        const m = raceRoomId.match(/^race_(.+?)_(.+?)_\d+$/)
                        if (m) {
                            const p1 = normalizeUserId(m[1]) || m[1]
                            const p2 = normalizeUserId(m[2]) || m[2]
                            const dNorm = normalizeUserId(disconnectedUserId) || disconnectedUserId
                            otherPlayerId = p1 === dNorm ? p2 : p1
                        }
                    }
                    // Notify everyone still in that race room first (spectators + opponent if present)
                    if (raceRoomId) {
                        io.to(raceRoomId).emit('raceOpponentLeft')
                    }
                    if (otherPlayerId) {
                        const otherData = await getUserSocket(otherPlayerId)
                        if (otherData?.socketId) {
                            io.to(otherData.socketId).emit('raceOpponentLeft')
                        }
                        io.emit('userAvailableRace', { userId: otherPlayerId })
                        await deleteActiveRaceGame(otherPlayerId).catch(() => {})
                    }
                    io.emit('userAvailableRace', { userId: disconnectedUserId })
                    await deleteActiveRaceGame(disconnectedUserId).catch(() => {})
                    await deleteRaceGameState(raceRoomId).catch(() => {})
                    try { io.in(raceRoomId).socketsLeave(raceRoomId) } catch (_) {}
                }, 30000)
            }

            // Handle card game disconnection (same pattern as chess)
            if (disconnectedUserId && await hasActiveCardGame(disconnectedUserId)) {
                const gameRoomId = await getActiveCardGame(disconnectedUserId)
                console.log(`🃏 User ${disconnectedUserId} disconnected while in card game: ${gameRoomId}`)
                console.log(`⏳ Waiting 10 seconds to see if user reconnects (page refresh)...`)
                
                // Find the other player — primary: parse roomId (multi-server safe)
                let otherPlayerId = null
                const cardRoomMatch = gameRoomId && gameRoomId.match(/^card_(.+?)_(.+?)_\d+$/)
                if (cardRoomMatch) {
                    const p1 = normalizeUserId(cardRoomMatch[1]) || cardRoomMatch[1]
                    const p2 = normalizeUserId(cardRoomMatch[2]) || cardRoomMatch[2]
                    otherPlayerId = p1 === disconnectedUserId ? p2 : p1
                }
                // Fallback: use Redis game state (in case room ID format ever changes)
                if (!otherPlayerId) {
                    const gameState = await getCardGameState(gameRoomId).catch(() => null)
                    if (gameState && gameState.players) {
                        const otherPlayer = gameState.players.find((p) => p.userId !== disconnectedUserId)
                        if (otherPlayer) otherPlayerId = otherPlayer.userId
                    }
                }
                
                // Wait 10 seconds before ending the game (allows time for page refresh reconnect)
                setTimeout(async () => {
                    // Check if user reconnected
                    const stillInGame = await hasActiveCardGame(disconnectedUserId)
                    const reconnectedSocket = await getUserSocket(disconnectedUserId)
                    
                    if (stillInGame && reconnectedSocket) {
                        console.log(`✅ User ${disconnectedUserId} reconnected - card game continues!`)
                        return // User reconnected, don't end the game
                    }
                    
                    // User didn't reconnect - end the game
                    console.log(`❌ User ${disconnectedUserId} did not reconnect - ending card game`)
                    
                    // Notify the other player
                    if (otherPlayerId) {
                        const otherPlayerData = await getUserSocket(otherPlayerId)
                        const otherPlayerSocketId = otherPlayerData?.socketId
                        if (otherPlayerSocketId) {
                            io.to(otherPlayerSocketId).emit("opponentLeftGame")
                            io.to(otherPlayerSocketId).emit("cardGameCleanup")
                        }
                    }
                    
                    // Notify all spectators in the room
                    if (gameRoomId) {
                        const room = io.sockets.adapter.rooms.get(gameRoomId)
                        if (room && room.size > 0) {
                            console.log(`👁️ Notifying ${room.size} spectators that card game ended (player disconnected)`)
                            io.to(gameRoomId).emit("cardGameEnded", { reason: 'player_disconnected' })
                        }
                    }
                    
                    // Delete card game post
                    deleteCardGamePost(gameRoomId).catch(err => {
                        console.error('❌ Error deleting card game post on disconnect:', err)
                    })
                    
                    // Remove from active games tracking (Redis)
                    await deleteActiveCardGame(disconnectedUserId)
                    if (otherPlayerId) {
                        await deleteActiveCardGame(otherPlayerId)
                    }
                    await deletePendingCardAcceptForUser(disconnectedUserId).catch(() => {})
                    if (otherPlayerId) await deletePendingCardAcceptForUser(otherPlayerId).catch(() => {})
                    
                    // Clean up game state (Redis)
                    await deleteCardGameState(gameRoomId)
                    console.log(`🗑️ Cleaned up card game state for room ${gameRoomId}`)
                    
                    // Make users available again
                    io.emit("userAvailableCard", { userId: disconnectedUserId })
                    if (otherPlayerId) {
                        io.emit("userAvailableCard", { userId: otherPlayerId })
                    }
                }, 10000) // Wait 10 seconds before ending game
            }
            
            // Remove socket from chess rooms
            // Get all chess rooms from Redis
            const allChessRooms = await getAllChessRooms()
            for (const [roomId, room] of Object.entries(allChessRooms)) {
                const index = room.indexOf(socket.id)
                if (index !== -1) {
                    room.splice(index, 1)
                    console.log(`👁️ Removed socket ${socket.id} from chess room ${roomId}`)
                    // Clean up empty rooms
                    if (room.length === 0) {
                        await deleteChessRoom(roomId)
                        console.log(`🗑️ Deleted empty chess room: ${roomId}`)
                    } else {
                        // Update room in Redis
                        await setChessRoom(roomId, room)
                    }
                }
            }

            // Emit updated online list as array of objects - get from Redis (source of truth)
            const remainingSockets = await getAllUserSockets()
            const busyUserIds = await getBusyUserIdsFromInCallKeys()
            
            const updatedOnlineArray = Object.entries(remainingSockets).map(([id, data]) => ({
                userId: id,
                onlineAt: data.onlineAt,
                inCall: busyUserIds.has(id), // Fast Set lookup, no database query
            }));
            if (!DISABLE_GLOBAL_ONLINE_BROADCAST) {
                console.log(`📤 [socket] Emitting getOnlineUser after disconnect with ${updatedOnlineArray.length} users`)
                io.emit("getOnlineUser", updatedOnlineArray)
            }
        })
    })

    return { io, server }
}

export const getRecipientSockedId = async (recipientId) => {
    return resolveLiveSocketIdForUser(recipientId)
}

// Export getUserSocket for use in HTTP endpoints
export { getUserSocket }
/** True when user has an active socket and Redis clientPresence is not `offline`. */
export { isUserEffectivelyOnline }

// Export getters for io and server
export const getIO = () => io
export const getUserSocketMap = () => userSocketMap
export { getAllUserSockets } // Export the async function
export const getServer = () => server
