import cron from 'node-cron'
import Notification from '../models/notification.js'
import Message from '../models/message.js'
import Conversation from '../models/conversation.js'
import FeedHiddenPost from '../models/feedHiddenPost.js'
import { deleteMediaAsset, isManagedMediaUrl } from './mediaStorage.js'

const DAY_MS = 24 * 60 * 60 * 1000

export const NOTIFICATION_RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '14', 10) || 14,
)
const MESSAGE_RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.MESSAGE_RETENTION_DAYS || '100', 10) || 100,
)
const FEED_HIDDEN_RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.FEED_HIDDEN_RETENTION_DAYS || '90', 10) || 90,
)
const BATCH_SIZE = Math.min(
  5000,
  Math.max(200, parseInt(process.env.RETENTION_CLEANUP_BATCH_SIZE || '2000', 10) || 2000),
)
const MAX_BATCHES_PER_RUN = Math.min(
  100,
  Math.max(1, parseInt(process.env.RETENTION_CLEANUP_MAX_BATCHES || '25', 10) || 25),
)

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

async function destroyManagedImages(urls) {
  const unique = [...new Set(urls.filter((u) => u && isManagedMediaUrl(u)))]
  if (!unique.length) return
  await Promise.allSettled(unique.map((url) => deleteMediaAsset(url)))
}

/** Delete notifications older than NOTIFICATION_RETENTION_DAYS in small batches. */
export async function cleanupOldNotifications(options = {}) {
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_RUN
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS)
  let totalDeleted = 0

  for (let i = 0; i < maxBatches; i += 1) {
    const stale = await Notification.find({ createdAt: { $lt: cutoff } })
      .select('_id')
      .limit(BATCH_SIZE)
      .lean()

    if (!stale.length) break

    const ids = stale.map((row) => row._id)
    const result = await Notification.deleteMany({ _id: { $in: ids } })
    totalDeleted += result.deletedCount || 0

    if (stale.length < BATCH_SIZE) break
  }

  if (totalDeleted > 0) {
    console.log(
      `🧹 [dataRetention] notifications: deleted ${totalDeleted} older than ${NOTIFICATION_RETENTION_DAYS}d`,
    )
  }

  return totalDeleted
}

/** Delete chat messages older than MESSAGE_RETENTION_DAYS in small batches. */
export async function cleanupOldMessages(options = {}) {
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_RUN
  const cutoff = new Date(Date.now() - MESSAGE_RETENTION_DAYS * DAY_MS)
  let totalDeleted = 0

  for (let i = 0; i < maxBatches; i += 1) {
    const stale = await Message.find({ createdAt: { $lt: cutoff } })
      .select('_id conversationId img')
      .limit(BATCH_SIZE)
      .lean()

    if (!stale.length) break

    const imageUrls = stale
      .map((row) => (row?.img && String(row.img).trim()) || '')
      .filter(Boolean)

    await destroyManagedImages(imageUrls)

    const ids = stale.map((row) => row._id)
    const conversationIds = [...new Set(stale.map((row) => String(row.conversationId)).filter(Boolean))]

    const result = await Message.deleteMany({ _id: { $in: ids } })
    totalDeleted += result.deletedCount || 0

    // Only refresh chats touched in this batch (cheap vs scanning all conversations).
    await Promise.allSettled(conversationIds.map((cid) => refreshConversationLastMessage(cid)))

    if (stale.length < BATCH_SIZE) break
  }

  if (totalDeleted > 0) {
    console.log(
      `🧹 [dataRetention] messages: deleted ${totalDeleted} older than ${MESSAGE_RETENTION_DAYS}d`,
    )
  }

  return totalDeleted
}

/** Drop "not interested" rows older than FEED_HIDDEN_RETENTION_DAYS — post can show in feed again. */
export async function cleanupOldFeedHiddenPosts(options = {}) {
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_RUN
  const cutoff = new Date(Date.now() - FEED_HIDDEN_RETENTION_DAYS * DAY_MS)
  let totalDeleted = 0

  for (let i = 0; i < maxBatches; i += 1) {
    const stale = await FeedHiddenPost.find({ createdAt: { $lt: cutoff } })
      .select('_id')
      .limit(BATCH_SIZE)
      .lean()

    if (!stale.length) break

    const ids = stale.map((row) => row._id)
    const result = await FeedHiddenPost.deleteMany({ _id: { $in: ids } })
    totalDeleted += result.deletedCount || 0

    if (stale.length < BATCH_SIZE) break
  }

  if (totalDeleted > 0) {
    console.log(
      `🧹 [dataRetention] feed hidden: deleted ${totalDeleted} older than ${FEED_HIDDEN_RETENTION_DAYS}d`,
    )
  }

  return totalDeleted
}

export async function runDataRetentionCleanup(options = {}) {
  const started = Date.now()
  const notifDeleted = await cleanupOldNotifications(options)
  const msgDeleted = await cleanupOldMessages(options)
  const hiddenDeleted = await cleanupOldFeedHiddenPosts(options)
  const ms = Date.now() - started

  if (notifDeleted > 0 || msgDeleted > 0 || hiddenDeleted > 0) {
    console.log(`✅ [dataRetention] done in ${ms}ms`)
  }

  return { notifDeleted, msgDeleted, hiddenDeleted, ms }
}

/** Daily off-peak batch cleanup — capped work per run so the server stays light. */
export const initializeDataRetentionCleanup = () => {
  console.log('🧹 Initializing data retention cleanup cron...')
  console.log(`   - Notifications: ${NOTIFICATION_RETENTION_DAYS} days`)
  console.log(`   - Messages: ${MESSAGE_RETENTION_DAYS} days`)
  console.log(`   - Feed hidden (not interested): ${FEED_HIDDEN_RETENTION_DAYS} days`)
  console.log(`   - Batch: ${BATCH_SIZE}, max batches/run: ${MAX_BATCHES_PER_RUN}`)

  // 03:30 UTC daily — low traffic; gentle catch-up on boot (2 batches only).
  cron.schedule('30 3 * * *', async () => {
    console.log(`🧹 [CRON] data retention cleanup ${new Date().toISOString()}`)
    try {
      await runDataRetentionCleanup()
    } catch (err) {
      console.error('❌ [CRON] data retention cleanup:', err?.message || err)
    }
  })

  setTimeout(async () => {
    console.log('🧹 [STARTUP] light data retention catch-up (2 batches max each)...')
    try {
      await runDataRetentionCleanup({ maxBatches: 2 })
    } catch (err) {
      console.error('❌ [STARTUP] data retention cleanup:', err?.message || err)
    }
  }, 25000)

  console.log('✅ Data retention cron: daily 03:30 UTC + light startup catch-up')
}
