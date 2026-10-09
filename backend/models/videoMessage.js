import mongoose from 'mongoose'

/**
 * Video Messages — private 1-to-1 video the receiver can answer *inside* a moment.
 * Notes (replies pinned to a second) live in their own collection (VideoNote) so this
 * document stays small no matter how many replies a video gets.
 *
 * `markers` are the sender's own small hints ("look here", "what do you think?") —
 * bounded to a handful per video, so embedding is fine.
 */
const markerSchema = new mongoose.Schema(
  {
    t: { type: Number, required: true, min: 0 }, // seconds into the video
    type: { type: String, enum: ['mark', 'question'], default: 'mark' },
    text: { type: String, default: '', maxlength: 120 },
  },
  { _id: false },
)

const videoMessageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Both people on one field so inbox is one indexed query, not $or.
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    videoUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: '' },
    duration: { type: Number, default: 0, min: 0 }, // seconds
    markers: { type: [markerSchema], default: [] },
    noteCount: { type: Number, default: 0 },
    lastNoteAt: { type: Date, default: null },
    seenAt: { type: Date, default: null }, // receiver opened it
    // Set when the sender has unseen replies (cleared when sender opens it).
    senderHasNewNotes: { type: Boolean, default: false },
  },
  { timestamps: true },
)

// Inbox: everything I received / sent, newest first (cursor on createdAt,_id).
videoMessageSchema.index({ participants: 1, createdAt: -1, _id: -1 })
videoMessageSchema.index({ receiver: 1, createdAt: -1, _id: -1 })
videoMessageSchema.index({ sender: 1, createdAt: -1, _id: -1 })
// Unseen badge for the receiver / sender-with-replies.
videoMessageSchema.index({ receiver: 1, seenAt: 1 })
videoMessageSchema.index({ sender: 1, senderHasNewNotes: 1 })

const VideoMessage = mongoose.model('VideoMessage', videoMessageSchema)
export default VideoMessage
