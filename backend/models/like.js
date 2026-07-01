import mongoose from 'mongoose'

/**
 * Post likes as their own collection (scalable to millions of likes per post).
 * Replaces the legacy `Post.likes[]` array. Source of truth for who-liked lists
 * and for `likedByMe`; the fast display count lives denormalized on `Post.likeCount`.
 */
const LikeSchema = mongoose.Schema(
    {
        post: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Post',
            required: true,
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    { timestamps: true },
)

// One like per (post, user) — also serves post-scoped lookups.
LikeSchema.index({ post: 1, user: 1 }, { unique: true })
// Newest-first pagination of a post's likers (cursor by _id).
LikeSchema.index({ post: 1, _id: -1 })
// Batched "did this viewer like these posts?" lookups (feed/profile pages).
LikeSchema.index({ user: 1, post: 1 })

const Like = mongoose.model('Like', LikeSchema)

export default Like
