import mongoose from 'mongoose'
import FeedHiddenPost from '../models/feedHiddenPost.js'
import User from '../models/user.js'

export const MAX_HIDDEN_FEED_POSTS = 500

export function hiddenPostQueryFilter(hiddenObjectIds) {
    if (!hiddenObjectIds?.length) return {}
    return { _id: { $nin: hiddenObjectIds } }
}

export async function getHiddenFeedPostObjectIds(userId) {
    await migrateLegacyHiddenFeedPostIds(userId)
    const rows = await FeedHiddenPost.find({ userId })
        .sort({ createdAt: -1 })
        .limit(MAX_HIDDEN_FEED_POSTS)
        .select('postId')
        .lean()
    const ids = []
    for (const row of rows) {
        const pid = row.postId?.toString?.() ?? String(row.postId ?? '')
        if (/^[0-9a-fA-F]{24}$/.test(pid)) {
            ids.push(new mongoose.Types.ObjectId(pid))
        }
    }
    return ids
}

export async function getHiddenFeedPostIdStrings(userId) {
    await migrateLegacyHiddenFeedPostIds(userId)
    const rows = await FeedHiddenPost.find({ userId })
        .sort({ createdAt: -1 })
        .limit(MAX_HIDDEN_FEED_POSTS)
        .select('postId')
        .lean()
    return rows
        .map((row) => String(row.postId))
        .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
}

/** Record that this viewer does not want to see a post again. Does not delete the post. */
export async function addHiddenFeedPostForUser(userId, postId) {
    const pid = String(postId || '').trim()
    if (!pid || !/^[0-9a-fA-F]{24}$/.test(pid)) return false

    const userObjectId = userId
    const postObjectId = new mongoose.Types.ObjectId(pid)

    await FeedHiddenPost.findOneAndUpdate(
        { userId: userObjectId, postId: postObjectId },
        { $setOnInsert: { userId: userObjectId, postId: postObjectId } },
        { upsert: true }
    )

    const count = await FeedHiddenPost.countDocuments({ userId: userObjectId })
    if (count > MAX_HIDDEN_FEED_POSTS) {
        const trim = count - MAX_HIDDEN_FEED_POSTS
        const oldest = await FeedHiddenPost.find({ userId: userObjectId })
            .sort({ createdAt: 1 })
            .limit(trim)
            .select('_id')
            .lean()
        if (oldest.length) {
            await FeedHiddenPost.deleteMany({ _id: { $in: oldest.map((d) => d._id) } })
        }
    }
    return true
}

/** Move old User.hiddenFeedPostIds arrays into FeedHiddenPost (one-time per user). */
async function migrateLegacyHiddenFeedPostIds(userId) {
    const legacy = await User.findById(userId).select('hiddenFeedPostIds').lean()
    const ids = legacy?.hiddenFeedPostIds
    if (!Array.isArray(ids) || ids.length === 0) return

    for (const id of ids.slice(0, MAX_HIDDEN_FEED_POSTS)) {
        await addHiddenFeedPostForUser(userId, id)
    }
    await User.findByIdAndUpdate(userId, { $unset: { hiddenFeedPostIds: 1 } })
}
