import mongoose from 'mongoose'

const FollowSchema = mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    followeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
)

// Ensure uniqueness (no duplicate follows)
FollowSchema.index({ followerId: 1, followeeId: 1 }, { unique: true })
// Query helpers
FollowSchema.index({ followeeId: 1, createdAt: -1 })
FollowSchema.index({ followerId: 1, createdAt: -1 })

const Follow = mongoose.model('Follow', FollowSchema)
export default Follow
