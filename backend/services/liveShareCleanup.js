/**
 * Remove LIVE_SHARE chat messages when a broadcaster's live ends.
 * Indexed by liveShareStreamerId — safe to run in background at stream end.
 */

import Message from '../models/message.js'
import Conversation from '../models/conversation.js'

export const LIVE_SHARE_PREFIX = 'LIVE_SHARE:'

function liveShareTextPattern(streamerId) {
    const sid = String(streamerId || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!sid) return null
    return new RegExp(`^LIVE_SHARE:\\{"streamerId":"${sid}"`)
}

async function refreshConversationLastMessage(conversationId) {
    const cid = String(conversationId)
    const last = await Message.findOne({ conversationId: cid })
        .sort({ createdAt: -1 })
        .select('text sender')
        .lean()
    if (last) {
        await Conversation.findByIdAndUpdate(cid, {
            lastMessage: { text: last.text, sender: last.sender },
        })
        return
    }
    await Conversation.findByIdAndUpdate(cid, {
        lastMessage: { text: '', sender: null },
    })
}

/**
 * Delete all chat cards for this streamer (indexed query + legacy regex fallback).
 * @returns {{ deleted: number, conversationIds: string[] }}
 */
export async function purgeLiveShareMessagesForStreamer(streamerId) {
    const sid = String(streamerId || '').trim()
    if (!sid) return { deleted: 0, conversationIds: [] }

    const legacyPattern = liveShareTextPattern(sid)
    const query = legacyPattern
        ? { $or: [{ liveShareStreamerId: sid }, { text: legacyPattern }] }
        : { liveShareStreamerId: sid }

    const messages = await Message.find(query)
        .select('_id conversationId')
        .lean()

    if (!messages.length) return { deleted: 0, conversationIds: [] }

    const conversationIds = [...new Set(messages.map((m) => String(m.conversationId)))]
    await Message.deleteMany({ _id: { $in: messages.map((m) => m._id) } })
    await Promise.all(conversationIds.map((cid) => refreshConversationLastMessage(cid)))

    console.log(`🧹 [liveShare] Removed ${messages.length} card(s) in ${conversationIds.length} chat(s) — streamer:${sid}`)
    return { deleted: messages.length, conversationIds }
}
