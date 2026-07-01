/**
 * One-time backfill: populate Conversation.lastMessage with full denormalized fields
 * (createdAt, delivered, seen, messageId) from the latest Message per conversation.
 *
 * Safe to re-run: only updates conversations missing lastMessage.createdAt.
 *
 * Run from the backend directory:
 *   node scripts/backfillConversationLastMessage.js
 */
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Conversation from '../models/conversation.js'
import Message from '../models/message.js'
import { buildConversationLastMessageFromMessage } from '../services/conversationLastMessage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config()
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const BATCH = 200

async function run() {
  if (!process.env.MONGO) {
    console.error('❌ MONGO env var is not set.')
    process.exit(1)
  }
  await mongoose.connect(process.env.MONGO)
  console.log('✅ Connected. Backfilling conversation lastMessage denorm...')

  const cursor = Conversation.find({
    $or: [
      { 'lastMessage.createdAt': { $exists: false } },
      { 'lastMessage.createdAt': null },
    ],
  })
    .select('_id')
    .lean()
    .cursor()

  let processed = 0
  let updated = 0
  let batch = []

  const flush = async () => {
    if (!batch.length) return
    await Promise.all(
      batch.map(async (convId) => {
        const last = await Message.findOne({ conversationId: convId })
          .sort({ createdAt: -1 })
          .select('text sender seen delivered createdAt img')
          .lean()
        if (last) {
          await Conversation.updateOne(
            { _id: convId },
            { $set: { lastMessage: buildConversationLastMessageFromMessage(last) } },
          )
          updated++
        }
      }),
    )
    batch = []
  }

  for await (const conv of cursor) {
    batch.push(conv._id)
    processed++
    if (batch.length >= BATCH) await flush()
    if (processed % 1000 === 0) {
      console.log(`  …scanned ${processed}, updated ${updated}`)
    }
  }
  await flush()

  console.log(`✅ Done. Conversations scanned: ${processed}, updated: ${updated}`)
  await mongoose.disconnect()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
