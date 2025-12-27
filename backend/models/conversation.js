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
},{timestamps:true})

// CRITICAL: Add indexes for performance - essential for production
// Index on participants for fast conversation lookups
ConversationSchema.index({ participants: 1 })
// Index on updatedAt for sorting conversations by most recent
ConversationSchema.index({ updatedAt: -1 })

const Conversation = mongoose.model("Conversation",ConversationSchema)

export default Conversation