import mongoose from 'mongoose';

const liveStreamSchema = new mongoose.Schema({
    streamer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    roomName:   { type: String, required: true },
    active:     { type: Boolean, default: true },
    startedAt:  { type: Date,   default: Date.now },
    endedAt:    { type: Date },
}, { timestamps: false });

// Only one active stream per streamer at a time
liveStreamSchema.index({ streamer: 1, active: 1 });

const LiveStream = mongoose.model('LiveStream', liveStreamSchema);
export default LiveStream;
