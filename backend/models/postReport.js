import mongoose from 'mongoose'

const PostReportSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, default: 'adult', maxlength: 40 },
  },
  { timestamps: true },
)

PostReportSchema.index({ postId: 1, reporterId: 1 }, { unique: true })

export default mongoose.model('PostReport', PostReportSchema)
