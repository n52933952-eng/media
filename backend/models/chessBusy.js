import mongoose from 'mongoose'

const ChessBusySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    opponentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    roomId: {
        type: String,
        required: true
    }
}, { timestamps: true })

const ChessBusy = mongoose.model('ChessBusy', ChessBusySchema)

export default ChessBusy


