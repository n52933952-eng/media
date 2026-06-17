/**
 * Remove legacy Post.replies[] after backfillComments.js.
 * Comments then live only in the comments collection.
 *
 * Run once: node backend/scripts/clearLegacyPostReplies.js
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Post from '../models/post.js'

dotenv.config()

async function main() {
  if (!process.env.MONGO) {
    console.error('❌ MONGO env not set')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO, { maxPoolSize: 10 })
  console.log('✅ Connected. Clearing legacy embedded replies from posts...')

  const result = await Post.updateMany(
    { replies: { $exists: true } },
    { $unset: { replies: '' } },
  )

  console.log(
    `✅ Cleared embedded replies on ${result.modifiedCount ?? result.nModified ?? 0} post(s)`,
  )
  console.log('   Comments now live only in the comments collection.')
  await mongoose.disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('❌ Cleanup failed:', e)
  process.exit(1)
})
