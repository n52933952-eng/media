import Conversation from '../models/conversation.js'
import Message from '../models/message.js'
import { getRecipientSockedId, getIO } from '../socket/socket.js'


export const sendMessaeg = async(req,res) => {

  try{
  
 const{recipientId,message}= req.body
 const senderId = req.user._id  // Fix: Use _id instead of id
 let{img}= req.body
 let conversation = await Conversation.findOne({ participants:{$all:[senderId,recipientId]}})

 if(!conversation){
    conversation = new Conversation({participants:[senderId,recipientId],
        lastMessage:{text:message,
            sender:senderId
        }
    })
    await conversation.save()
 }

const newMessage = new Message({conversationId:conversation._id,sender:senderId,text:message,img})

await Promise.all([newMessage.save(),conversation.updateOne({lastMessage:{text:message,sender:senderId}})])
  
// Populate sender data before sending
await newMessage.populate("sender", "username profilePic name")

const recipentSockedId = getRecipientSockedId(recipientId)
const io = getIO() // Get io instance

if(recipentSockedId && recipientId && io){
  io.to(recipentSockedId).emit("newMessage",newMessage)
}


res.status(201).json(newMessage)
  }
  catch(error){
    res.status(500).json(error)
    console.log(error)
  }
}



export const getMessage = async(req,res) => {

     const{otherUserId} = req.params
     const userId = req.user._id  // Fix: Use _id instead of id
   
     try{
    
    const conversation = await Conversation.findOne({participants:{$all:[userId,otherUserId]}})
   
    // Fix: Handle case when conversation doesn't exist
    if(!conversation){
        return res.status(200).json([]) // Return empty array if no conversation exists
    }
   
    const messages = await Message.find({conversationId:conversation._id})
      .populate("sender", "username profilePic name")
      .populate("reactions.userId", "username name profilePic")
      .sort({createdAt:1})
   
    res.status(200).json(messages)
   

}
    catch(error){
        res.status(500).json(error)
        console.log(error)
    }
}


export const mycon = async(req,res) => {
 
	try {
		const userId = req.user._id  // Fix: Use authenticated user's _id
   
		const conversations = await Conversation.find({participants:userId}).populate({
			path: "participants",
			select: "username profilePic",
    }).sort({createdAt:-1});

    // Calculate unread counts for each conversation
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conversation) => {
        // Filter participants to get the other user
        conversation.participants = conversation.participants.filter(
          (participant) => participant._id.toString() !== userId.toString()
        );

        // Count unread messages (messages not seen and not sent by current user)
        const unreadCount = await Message.countDocuments({
          conversationId: conversation._id,
          seen: false,
          sender: { $ne: userId }
        });

        // Convert to plain object and add unreadCount
        const convObj = conversation.toObject();
        convObj.unreadCount = unreadCount;
        
        return convObj;
      })
    );

res.status(200).json(conversationsWithUnread);
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
}


export const deletconversation =async (req,res) => {
 


  try{
  
  
 await Message.deleteMany({conversationId:req.params.id})

await Conversation.findByIdAndDelete(req.params.id)
res.status(200).json("all deleted")
}
 catch(error){
     res.status(500).json(error)
     console.log(error)
 }
}

// Add or remove reaction to a message
export const toggleReaction = async (req, res) => {
  try {
    const { messageId } = req.params
    const { emoji } = req.body
    const userId = req.user._id

    const message = await Message.findById(messageId)
    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // Check if user already has ANY reaction on this message
    const existingUserReactionIndex = message.reactions.findIndex(
      r => r.userId.toString() === userId.toString()
    )

    if (existingUserReactionIndex > -1) {
      const existingReaction = message.reactions[existingUserReactionIndex]
      // If user clicked the same emoji, remove it
      if (existingReaction.emoji === emoji) {
        message.reactions.splice(existingUserReactionIndex, 1)
      } else {
        // Replace old reaction with new one
        message.reactions[existingUserReactionIndex].emoji = emoji
      }
    } else {
      // User doesn't have any reaction yet, add new one
      message.reactions.push({ userId, emoji })
    }

    await message.save()
    
    // Populate userId in reactions for response
    await message.populate('reactions.userId', 'username name profilePic')

    // Emit socket event to notify all participants in the conversation
    const conversation = await Conversation.findById(message.conversationId)
    if (conversation) {
      const io = getIO()
      if (io) {
        // Emit to all participants
        conversation.participants.forEach(participantId => {
          // Find socket ID for this participant
          // We'll emit to all connected sockets since we need to notify all participants
          io.emit("messageReactionUpdated", { 
            conversationId: message.conversationId.toString(),
            messageId: message._id.toString()
          })
        })
      }
    }

    res.status(200).json(message)
  } catch (error) {
    res.status(500).json({ error: error.message })
    console.log(error)
  }
}