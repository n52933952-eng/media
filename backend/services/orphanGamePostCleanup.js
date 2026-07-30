/**
 * Delete stuck chess/card game posts from Mongo when the live game is already gone.
 * Triggered (throttled) from busyChessUsers / busyCardUsers — same path the feed prune uses.
 * No new mobile build required.
 */
import Post from '../models/post.js'
import * as redisService from './redis.js'
import { debugLog } from '../utils/debugLog.js'

const THROTTLE_SEC = 60
const MIN_AGE_MS = 90_000
const MAX_ROOMS_PER_RUN = 25
const SCAN_LIMIT = 200

const parsePlayers = (raw) => {
    if (!raw) return []
    try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw
        const out = []
        for (const key of ['player1', 'player2']) {
            const id = data?.[key]?._id != null ? String(data[key]._id).trim() : ''
            if (id) out.push(id)
        }
        return out
    } catch {
        return []
    }
}

const isStillLiveLooking = (raw) => {
    if (!raw) return true
    try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw
        return data?.gameStatus === 'active' || data?.gameStatus == null
    } catch {
        return true
    }
}

/**
 * @param {'chess'|'card'} kind
 * @param {string[]} busyUserIds
 */
export const maybeCleanupOrphanGamePosts = async (kind, busyUserIds = []) => {
    if (kind !== 'chess' && kind !== 'card') return
    try {
        redisService.ensureRedis()
        const client = redisService.getRedis()
        if (!client) return

        const throttleKey = `orphanGamePostCleanup:${kind}`
        // Only one cleanup pass per kind per minute across the fleet.
        const locked = await client.set(throttleKey, '1', { NX: true, EX: THROTTLE_SEC })
        if (locked !== 'OK' && locked !== true) return

        const prefix = kind === 'chess' ? 'chess_' : 'card_'
        const dataField = kind === 'chess' ? 'chessGameData' : 'cardGameData'
        const statePrefix = kind === 'chess' ? 'chessGameState:' : 'cardGameState:'
        const busy = new Set((busyUserIds || []).map((id) => String(id || '').trim()).filter(Boolean))
        const cutoff = new Date(Date.now() - MIN_AGE_MS)

        const posts = await Post.find({
            gameRoomId: { $regex: `^${prefix}` },
            createdAt: { $lte: cutoff },
        })
            .select(`gameRoomId ${dataField} createdAt`)
            .sort({ createdAt: 1 })
            .limit(SCAN_LIMIT)
            .lean()

        if (!posts.length) return

        const byRoom = new Map()
        for (const post of posts) {
            const roomId = post.gameRoomId != null ? String(post.gameRoomId) : ''
            if (!roomId || byRoom.has(roomId)) continue
            if (!isStillLiveLooking(post[dataField])) continue
            byRoom.set(roomId, post)
        }

        const { deleteChessGamePost, deleteCardGamePost } = await import('../controller/post.js')

        let cleaned = 0
        for (const [roomId, sample] of byRoom) {
            if (cleaned >= MAX_ROOMS_PER_RUN) break

            const players = parsePlayers(sample[dataField])
            if (players.some((id) => busy.has(id))) continue

            // Still has Redis game state → treat as live (busy keys may have flapped).
            let hasState = false
            try {
                hasState = !!(await client.get(`${statePrefix}${roomId}`))
            } catch {
                hasState = true // fail closed
            }
            if (hasState) continue

            if (kind === 'chess') {
                await deleteChessGamePost(roomId)
            } else {
                await deleteCardGamePost(roomId)
            }
            cleaned++
            debugLog(`🧹 [orphanGamePosts] Deleted stuck ${kind} posts for room ${roomId}`)
        }

        if (cleaned > 0) {
            console.log(`🧹 [orphanGamePosts] Cleaned ${cleaned} stuck ${kind} room(s) from DB`)
        }
    } catch (err) {
        console.error(`❌ [orphanGamePosts] ${kind} cleanup failed:`, err?.message || err)
    }
}
