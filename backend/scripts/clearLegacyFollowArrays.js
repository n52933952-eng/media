import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/user.js'

dotenv.config()

async function main() {
  if (!process.env.MONGO) {
    console.error('❌ MONGO env not set')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO, { maxPoolSize: 10 })
  console.log('✅ Connected. Removing legacy followers/following arrays from all users...')

  const result = await User.updateMany(
    {},
    { $unset: { followers: '', following: '' } },
  )

  console.log(`✅ Cleared legacy arrays on ${result.modifiedCount ?? result.nModified ?? 0} user(s)`)
  console.log('   Follow data now lives only in the follows collection.')
  await mongoose.disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('❌ Cleanup failed:', e)
  process.exit(1)
})
