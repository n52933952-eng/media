import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/user.js'
import Follow from '../models/follow.js'

dotenv.config()

async function main() {
  if (!process.env.MONGO) {
    console.error('❌ MONGO env not set')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO, {
    maxPoolSize: 10,
  })

  console.log('✅ Connected. Starting backfill...')

  const cursor = User.find({}, { followers: 1 }).cursor()
  let count = 0
  for await (const user of cursor) {
    const followeeId = user._id
    const followerIds = Array.isArray(user.followers) ? user.followers : []
    for (const followerId of followerIds) {
      if (!followerId) continue
      try {
        await Follow.updateOne(
          { followerId, followeeId },
          { $setOnInsert: { followerId, followeeId } },
          { upsert: true }
        )
        count++
      } catch (e) {
        if (e?.code === 11000) continue
        console.error('⚠️ Error upserting follow', followerId?.toString?.(), followeeId?.toString?.(), e.message)
      }
    }
  }

  console.log(`✅ Backfill done. Upserted ~${count} follow docs`)
  await mongoose.disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('❌ Backfill failed:', e)
  process.exit(1)
})
