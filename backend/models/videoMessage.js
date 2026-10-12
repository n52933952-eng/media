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
    type: { type: String, enum: ['mark', 'question', 'reply'], default: 'mark' },
    text: { type: String, default: '', maxlength: 120 },
  },
  { _id: false },
)

const videoMessageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Set for 1-to-1. A group leaves this empty and uses `participants`.
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isGroup: { type: Boolean, default: false },
    // Sender plus up to 9 people they follow. Hard cap keeps every video one small read.
    memberCount: { type: Number, default: 2, min: 2, max: 10 },
    // Everyone on one field so inbox is one indexed query, not $or.
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
    // How many replies/reactions the other person has not opened yet.
    senderUnseenNotes: { type: Number, default: 0, min: 0 },
    receiverUnseenNotes: { type: Number, default: 0, min: 0 },
    // Finished download of this video plus its replies and reactions. Rebuilt when those change.
    exportUrl: { type: String, default: '' },
    exportHash: { type: String, default: '' },
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
videoMessageSchema.index({ sender: 1, senderUnseenNotes: 1 })
videoMessageSchema.index({ receiver: 1, receiverUnseenNotes: 1 })

const VideoMessage = mongoose.model('VideoMessage', videoMessageSchema)
export default VideoMessage
