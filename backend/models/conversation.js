import mongoose from 'mongoose'

const ConversationSchema = new mongoose.Schema({

    participants: [{
       type:mongoose.Schema.Types.ObjectId,
            ref:"User",
}],

    lastMessage:{
        text:String,
        sender:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User"
        },
        seen:{
            type:Boolean,
            default:false
        },
    },

    // ── Group conversation fields ──────────────────────────────────────────
    isGroup:     { type: Boolean, default: false },
    groupName:   { type: String,  default: '' },
    groupAvatar: { type: String,  default: '' },
    /** ObjectId of the group admin (can rename, add/remove members). */
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },

},{timestamps:true})

// CRITICAL: Add indexes for performance - essential for production
// Index on participants for fast conversation lookups
ConversationSchema.index({ participants: 1 })
// Index on updatedAt for sorting conversations by most recent
ConversationSchema.index({ updatedAt: -1 })
// Index for group admin queries (e.g. "find groups I admin")
ConversationSchema.index({ isGroup: 1, admin: 1 }, { sparse: true })

const Conversation = mongoose.model("Conversation",ConversationSchema)

export default Conversation