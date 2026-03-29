import mongoose from 'mongoose'

const StorySlideSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['image', 'video'], required: true },
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    /** Video length in seconds (images use display duration client-side, default 5s) */
    durationSec: { type: Number, default: 5 },
  },
  { _id: false }
)

const StoryViewerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    viewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
)

const StorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    slides: { type: [StorySlideSchema], validate: [(v) => v?.length > 0, 'At least one slide'] },
    expiresAt: { type: Date, required: true, index: true },
    viewers: { type: [StoryViewerSchema], default: [] },
  },
  { timestamps: true }
)

StorySchema.index({ user: 1, expiresAt: -1 })

export default mongoose.model('Story', StorySchema)
