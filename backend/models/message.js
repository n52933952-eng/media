import mongoose from 'mongoose'

const MessageSchema = new mongoose.Schema({

    conversationId :{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Conversation"
    },

    sender:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User"
    },

    text:String,

    seen:{
        type:Boolean,
        default:false
    },

    img:{
        type:String,
        default:""
    },

    reactions: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
        emoji: String
    }],

    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: null
    },

},{timestamps:true})

// CRITICAL: Add indexes for performance - essential for production
// Index on conversationId + createdAt for fast message queries
MessageSchema.index({ conversationId: 1, createdAt: -1 })
// Index on sender for fast lookups
MessageSchema.index({ sender: 1 })
// Index on seen + conversationId for unread count queries
MessageSchema.index({ conversationId: 1, seen: 1, sender: 1 })

const Message = mongoose.model("Message",MessageSchema)

export default Message