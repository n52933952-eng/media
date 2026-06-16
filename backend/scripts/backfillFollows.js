import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/user.js'
import Follow from '../models/follow.js'

dotenv.config()

const upsertFollow = async (followerId, followeeId) => {
  if (!followerId || !followeeId) return false
  const a = followerId.toString()
  const b = followeeId.toString()
  if (a === b) return false
  if (!mongoose.isValidObjectId(a) || !mongoose.isValidObjectId(b)) return false
  try {
    await Follow.updateOne(
      { followerId: a, followeeId: b },
      { $setOnInsert: { followerId: a, followeeId: b } },
      { upsert: true },
    )
    return true
  } catch (e) {
    if (e?.code === 11000) return false
    console.error('⚠️ Error upserting follow', a, '->', b, e.message)
    return false
  }
}

async function main() {
  if (!process.env.MONGO) {
    console.error('❌ MONGO env not set')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO, { maxPoolSize: 10 })
  console.log('✅ Connected. Starting backfill (followers + following arrays)...')

  let count = 0
  const cursor = User.find({}, { followers: 1, following: 1 }).cursor()

  for await (const user of cursor) {
    const followeeId = user._id
    const followerIds = Array.isArray(user.followers) ? user.followers : []
    for (const followerId of followerIds) {
      if (await upsertFollow(followerId, followeeId)) count++
    }

    const followingIds = Array.isArray(user.following) ? user.following : []
    for (const fid of followingIds) {
      if (await upsertFollow(followeeId, fid)) count++
    }
  }

  console.log(`✅ Backfill done. Upserted ~${count} follow doc(s)`)
  await mongoose.disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('❌ Backfill failed:', e)
  process.exit(1)
})
