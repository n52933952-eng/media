import mongoose from 'mongoose'

const MentionedUserSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    username: { type: String, default: null },
  },
  { _id: false },
)

const CommentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    text: { type: String, required: true },
    username: { type: String, default: '' },
    name: { type: String, default: '' },
    userProfilePic: { type: String, default: '' },
    date: { type: Date, default: Date.now, index: true },
    parentReplyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment',
      default: null,
      index: true,
    },
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    mentionedUser: { type: MentionedUserSchema, default: null },
    footballMatchId: { type: String, default: null },
  },
  { timestamps: true },
)

CommentSchema.index({ postId: 1, date: 1 })
CommentSchema.index({ postId: 1, parentReplyId: 1, date: 1 })
CommentSchema.index({ userId: 1, date: -1 })

const Comment = mongoose.model('Comment', CommentSchema)
export default Comment
