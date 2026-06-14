import mongoose from 'mongoose'

const FeedHiddenPostSchema = mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    },
    { timestamps: true }
)

FeedHiddenPostSchema.index({ userId: 1, postId: 1 }, { unique: true })
FeedHiddenPostSchema.index({ userId: 1, createdAt: -1 })

const FeedHiddenPost = mongoose.model('FeedHiddenPost', FeedHiddenPostSchema)

export default FeedHiddenPost
