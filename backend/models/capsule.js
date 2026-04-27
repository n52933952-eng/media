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
    opened: {
      type: Boolean,
      default: false,
    },
    notified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
)

// Each user can only seal a given post once
CapsuleSchema.index({ postId: 1, sealedBy: 1 }, { unique: true })
// Efficient lookup of due-to-open capsules
CapsuleSchema.index({ openAt: 1, opened: 1 })

const Capsule = mongoose.model('Capsule', CapsuleSchema)
export default Capsule
