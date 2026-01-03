import mongoose from 'mongoose'

const ActivitySchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['like', 'comment', 'follow', 'post', 'reply']
    },
    targetUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    postId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Post"
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed // Store additional data like post text preview, etc.
    }
}, { timestamps: true })

// Index for efficient queries (composite indexes are better than individual)
ActivitySchema.index({ userId: 1, createdAt: -1 })
ActivitySchema.index({ targetUser: 1, createdAt: -1 })
ActivitySchema.index({ type: 1, createdAt: -1 }) // For filtering by activity type

const Activity = mongoose.model("Activity", ActivitySchema)

export default Activity


