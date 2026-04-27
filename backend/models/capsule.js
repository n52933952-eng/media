import mongoose from 'mongoose'

const CapsuleSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
    },
    sealedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    openAt: {
      type: Date,
      required: true,
    },
    selectedDuration: {
      type: String,
      required: true,
      enum: ['1m', '5m', '1h', '3d'],
    },
    selectedLabel: {
      type: String,
      required: true,
    },
    opened: {
      type: Boolean,
      default: false,
    },
    notified: {
      type: Boolean,
      default: false,
    },
    // Safety fallback: MongoDB TTL removes stale capsule rows automatically
    // even if a process crash prevents normal cleanup.
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
)

// Each user can only seal a given post once
CapsuleSchema.index({ postId: 1, sealedBy: 1 }, { unique: true })
// Efficient lookup of due-to-open capsules
CapsuleSchema.index({ openAt: 1, opened: 1 })
// Hard auto-cleanup at expiresAt
CapsuleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const Capsule = mongoose.model('Capsule', CapsuleSchema)
export default Capsule
