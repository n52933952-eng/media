import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true // For faster queries
    },
    type: {
        type: String,
        required: true,
        enum: ['follow', 'comment', 'mention', 'like', 'collaboration', 'post_edit'], // Types of notifications
        index: true
    },
    from: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true // Who triggered the notification
    },
    post: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        default: null // Post related to notification
    },
    comment: {
        type: String,
        default: null // Comment text for comment/mention notifications
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: null // For additional data like postText for collaboration/post_edit
    },
    read: {
        type: Boolean,
        default: false,
        index: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true // For sorting by date
    }
}, {
    timestamps: true
})

// Compound index for efficient queries (user + read status)
notificationSchema.index({ user: 1, read: 1, createdAt: -1 })

const Notification = mongoose.model('Notification', notificationSchema)

export default Notification


