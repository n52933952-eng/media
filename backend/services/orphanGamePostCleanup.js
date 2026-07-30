/**
 * Delete stuck chess/card game posts from Mongo when the live game is already gone.
 * Runs on a cron (not on feed/busy API requests) so app open stays light.
 */
import cron from 'node-cron'
import Post from '../models/post.js'
import * as redisService from './redis.js'
import { debugLog } from '../utils/debugLog.js'

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

const scanBusyUserIds = async (client, matchPattern, keyPrefix) => {
    const busy = new Set()
    if (!client) return busy
    let cursor = '0'
    let scanCount = 0
    const maxIterations = 100
    do {
        scanCount++
        if (scanCount > maxIterations) break
        const result = await client.scan(cursor, { MATCH: matchPattern, COUNT: 100 })
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
        for (const key of keys) {
            const userId = String(key).replace(keyPrefix, '')
            if (userId) busy.add(userId)
        }
    } while (cursor !== '0')
    return busy
}

/**
 * @param {'chess'|'card'} kind
 */
export const maybeCleanupOrphanGamePosts = async (kind) => {
    if (kind !== 'chess' && kind !== 'card') return
    try {
        redisService.ensureRedis()
        const client = redisService.getRedis()
        if (!client) return

        const prefix = kind === 'chess' ? 'chess_' : 'card_'
        const dataField = kind === 'chess' ? 'chessGameData' : 'cardGameData'
        const statePrefix = kind === 'chess' ? 'chessGameState:' : 'cardGameState:'
        const busyMatch = kind === 'chess' ? 'activeChessGame:*' : 'activeCardGame:*'
        const busyPrefix = kind === 'chess' ? 'activeChessGame:' : 'activeCardGame:'
        const busy = await scanBusyUserIds(client, busyMatch, busyPrefix)
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

            let hasState = false
            try {
                hasState = !!(await client.get(`${statePrefix}${roomId}`))
            } catch {
                hasState = true
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

const runOrphanGamePostCleanup = async () => {
    await maybeCleanupOrphanGamePosts('chess')
    await maybeCleanupOrphanGamePosts('card')
}

/** Every 2 minutes — independent of feed opens. */
export const initializeOrphanGamePostCleanup = () => {
    cron.schedule('*/2 * * * *', () => {
        void runOrphanGamePostCleanup()
    })
    // Soft delay after boot so startup traffic isn't competing with first cleanup.
    setTimeout(() => {
        void runOrphanGamePostCleanup()
    }, 60_000)
    console.log('✅ [orphanGamePosts] Cleanup cron initialized (every 2 minutes)')
}
