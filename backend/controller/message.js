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
   
    const messages = await Message.find({conversationId:conversation._id}).populate("sender", "username profilePic name").sort({createdAt:1})
   
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

    conversations.forEach((conversation) => {
			conversation.participants = conversation.participants.filter(
				(participant) => participant._id.toString() !== userId.toString()
			);
		});


res.status(200).json(conversations);
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