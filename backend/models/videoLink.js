import mongoose from 'mongoose'

const VideoLinkSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    url: { type: String, required: true },
    embedUrl: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    title: { type: String, default: 'Video' },
    provider: { type: String, default: 'video' },
}, { timestamps: true })

VideoLinkSchema.index({ userId: 1, url: 1 }, { unique: true })
VideoLinkSchema.index({ userId: 1, createdAt: -1 })

const VideoLink = mongoose.model('VideoLink', VideoLinkSchema)
export default VideoLink
