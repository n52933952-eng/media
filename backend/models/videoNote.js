import mongoose from 'mongoose'

/**
 * A reply pinned to a second of a VideoMessage.
 * type 'video'    → short clip (videoUrl + duration)
 * type 'reaction' → emoji only
 * One row per reply; fetched per video, ordered by time.
 */
const videoNoteSchema = new mongoose.Schema(
  {
    videoMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoMessage', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    t: { type: Number, required: true, min: 0 }, // seconds into the original video
    type: { type: String, enum: ['video', 'reaction'], required: true },
    videoUrl: { type: String, default: '' },
    duration: { type: Number, default: 0, min: 0 },
    reaction: { type: String, default: '', maxlength: 8 },
  },
  { timestamps: true },
)

videoNoteSchema.index({ videoMessage: 1, t: 1, _id: 1 })

const VideoNote = mongoose.model('VideoNote', videoNoteSchema)
export default VideoNote
