import mongoose from 'mongoose'

/**
 * One small row per person on a group video (max 10).
 * 1-to-1 videos do not use this. Seen and unseen stay on the video document there.
 * Badge counts are indexed lookups on this user, never a scan of every video.
 */
const videoMessageReceiptSchema = new mongoose.Schema(
  {
    videoMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoMessage', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: Boolean, default: false },
    seenAt: { type: Date, default: null },
    unseenNotes: { type: Number, default: 0, min: 0 },
  },
  { timestamps: false },
)

videoMessageReceiptSchema.index({ videoMessage: 1, user: 1 }, { unique: true })
videoMessageReceiptSchema.index({ user: 1, recipient: 1, seenAt: 1 })
videoMessageReceiptSchema.index({ user: 1, seenAt: 1, unseenNotes: 1 })

const VideoMessageReceipt = mongoose.model('VideoMessageReceipt', videoMessageReceiptSchema)
export default VideoMessageReceipt
