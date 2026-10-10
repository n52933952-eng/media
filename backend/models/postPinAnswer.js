import mongoose from 'mongoose'

/** One short answer per person per question pin. Kept off the post so the feed stays small. */
const PostPinAnswerSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    pinId: { type: mongoose.Schema.Types.ObjectId, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 200 },
  },
  { timestamps: true },
)

PostPinAnswerSchema.index({ post: 1, pinId: 1, _id: -1 })
PostPinAnswerSchema.index({ post: 1, pinId: 1, user: 1 }, { unique: true })

const PostPinAnswer = mongoose.model('PostPinAnswer', PostPinAnswerSchema)
export default PostPinAnswer
