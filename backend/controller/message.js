import Conversation from '../models/conversation.js'
import Message from '../models/message.js'
import { getRecipientSockedId, getIO } from '../socket/socket.js'
import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'


export const sendMessaeg = async(req,res) => {

  try{
  
 const{recipientId,message,replyTo}= req.body
 const senderId = req.user._id
 let img = ''
  
       // Handle file upload via Multer to Cloudinary
       if(req.file) {
         return new Promise((resolve, reject) => {
           // Create a readable stream from the buffer
           const stream = cloudinary.uploader.upload_stream(
             {
               resource_type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
               folder: 'messages',
               timeout: 1200000, // 20 minutes timeout for large videos
               chunk_size: 6000000, // 6MB chunks
             },
             async (error, result) => {
               if (error) {
                 console.error('Cloudinary upload error:', error)
                 if (!res.headersSent) {
                   res.status(500).json({ 
                     error: 'Failed to upload file to Cloudinary',
                     details: error.message 
                   })
                 }
                 reject(error)
                 return
               }
               
               img = result.secure_url
               
               try {
                 // Create message after upload completes
                 let conversation = await Conversation.findOne({ participants:{$all:[senderId,recipientId]}})

                 if(!conversation){
                    conversation = new Conversation({participants:[senderId,recipientId],
                        lastMessage:{text:message,
                            sender:senderId
                        }
                    })
                    await conversation.save()
                 }

                const newMessage = new Message({
                  conversationId:conversation._id,
                  sender:senderId,
                  text:message,
                  img,
                  replyTo: replyTo || null
                })

                // Update conversation lastMessage and timestamp
                conversation.lastMessage = {
                  text: message,
                  sender: senderId
                }
                conversation.updatedAt = new Date() // Explicitly set for immediate access
                
                await Promise.all([
                  newMessage.save(),
                  conversation.save() // Save with updated timestamp
                ])
                  
                // Populate sender data and replyTo message before sending
                await newMessage.populate("sender", "username profilePic name")
                if (newMessage.replyTo) {
                  await newMessage.populate({
                    path: "replyTo",
                    select: "text sender",
                    populate: {
                      path: "sender",
                      select: "username name profilePic"
                    }
                  })
                }
                  
                const recipentSockedId = await getRecipientSockedId(recipientId)
                const io = getIO()

                if(recipentSockedId && recipientId && io){
                  // Add conversation updatedAt to message for accurate sorting
                  const messageWithTimestamp = {
                    ...newMessage.toObject(),
                    conversationUpdatedAt: conversation.updatedAt
                  }
                  io.to(recipentSockedId).emit("newMessage", messageWithTimestamp)
                  
                  // Calculate and emit unread count update for recipient
                  try {
                    const recipientConversations = await Conversation.find({ participants: recipientId })
                    const totalUnread = await Promise.all(
                      recipientConversations.map(async (conv) => {
                        const unreadCount = await Message.countDocuments({
                          conversationId: conv._id,
                          seen: false,
                          sender: { $ne: recipientId }
                        })
                        return unreadCount || 0
                      })
                    )
                    const totalUnreadCount = totalUnread.reduce((sum, count) => sum + count, 0)
                    io.to(recipentSockedId).emit("unreadCountUpdate", { totalUnread: totalUnreadCount })
                  } catch (error) {
                    console.log('Error calculating unread count:', error)
                  }
                }

                if (!res.headersSent) {
                  // Send message with conversation timestamp to sender for accurate sorting
                  const responseData = {
                    ...newMessage.toObject(),
                    conversationUpdatedAt: conversation.updatedAt
                  }
                  console.log('📤 Sending message to sender with timestamp:', conversation.updatedAt)
                  res.status(201).json(responseData)
                }
                resolve()
               } catch (error) {
                 console.error('Error creating message after upload:', error)
                 if (!res.headersSent) {
                   res.status(500).json({ 
                     error: error.message || 'Failed to send message. Please try again.' 
                   })
                 }
                 reject(error)
               }
             }
           )
           
           // Convert buffer to stream and pipe to Cloudinary
           const bufferStream = new Readable()
           bufferStream.push(req.file.buffer)
           bufferStream.push(null)
           bufferStream.pipe(stream)
         })
       }
       
       // No file upload - proceed normally
 
 let conversation = await Conversation.findOne({ participants:{$all:[senderId,recipientId]}})

 if(!conversation){
    conversation = new Conversation({participants:[senderId,recipientId],
        lastMessage:{text:message,
            sender:senderId
        }
    })
    await conversation.save()
 }

const newMessage = new Message({
  conversationId:conversation._id,
  sender:senderId,
  text:message,
  img,
  replyTo: replyTo || null
})

// Update conversation lastMessage and timestamp
conversation.lastMessage = {
  text: message,
  sender: senderId
}
conversation.updatedAt = new Date() // Explicitly set for immediate access

await Promise.all([
  newMessage.save(),
  conversation.save() // Save with updated timestamp
])
  
// Populate sender data and replyTo message before sending
await newMessage.populate("sender", "username profilePic name")
if (newMessage.replyTo) {
  await newMessage.populate({
    path: "replyTo",
    select: "text sender",
    populate: {
      path: "sender",
      select: "username name profilePic"
    }
  })
}
  
const recipentSockedId = await getRecipientSockedId(recipientId)
const io = getIO() // Get io instance

if(recipentSockedId && recipientId && io){
  // Add conversation updatedAt to message for accurate sorting
  const messageWithTimestamp = {
    ...newMessage.toObject(),
    conversationUpdatedAt: conversation.updatedAt
  }
  io.to(recipentSockedId).emit("newMessage", messageWithTimestamp)
  
  // Calculate and emit unread count update for recipient
  try {
    const recipientConversations = await Conversation.find({ participants: recipientId })
    const totalUnread = await Promise.all(
      recipientConversations.map(async (conv) => {
        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          seen: false,
          sender: { $ne: recipientId }
        })
        return unreadCount || 0
      })
    )
    const totalUnreadCount = totalUnread.reduce((sum, count) => sum + count, 0)
    io.to(recipentSockedId).emit("unreadCountUpdate", { totalUnread: totalUnreadCount })
  } catch (error) {
    console.log('Error calculating unread count:', error)
  }
}


// Send message with conversation timestamp to sender for accurate sorting
const responseData = {
  ...newMessage.toObject(),
  conversationUpdatedAt: conversation.updatedAt
}
console.log('📤 Sending message to sender with timestamp:', conversation.updatedAt)
res.status(201).json(responseData)
  }
  catch(error){
    console.error('Error in sendMessaeg:', error)
    // Make sure to always send a response
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error.message || 'Failed to send message. Please try again.' 
      })
    }
  }
}



export const getMessage = async(req,res) => {

     const{otherUserId} = req.params
     const userId = req.user._id  // Fix: Use _id instead of id
   
     try{
    
    const conversation = await Conversation.findOne({participants:{$all:[userId,otherUserId]}})
   
    // Fix: Handle case when conversation doesn't exist
    if(!conversation){
        return res.status(200).json({ messages: [], hasMore: false }) // Return empty array if no conversation exists
    }
   
    // Pagination parameters
    const limit = parseInt(req.query.limit) || 12 // Default to 12 messages
    const beforeId = req.query.beforeId // Message ID to fetch messages before (for pagination)
    
    // Build query
    let query = { conversationId: conversation._id }
    
    // If beforeId is provided, fetch messages created before that message
    if (beforeId) {
      const beforeMessage = await Message.findById(beforeId)
      if (beforeMessage) {
        query.createdAt = { $lt: beforeMessage.createdAt }
      }
    }
    
    // Fetch messages with pagination
    const messages = await Message.find(query)
      .populate("sender", "username profilePic name")
      .populate("reactions.userId", "username name profilePic")
      .populate({
        path: "replyTo",
        select: "text sender",
        populate: {
          path: "sender",
          select: "username name profilePic"
        }
      })
      .sort({createdAt: -1}) // Sort descending (newest first) for pagination
      .limit(limit + 1) // Fetch one extra to check if there are more messages
   
    // Check if there are more messages
    const hasMore = messages.length > limit
    const messagesToReturn = hasMore ? messages.slice(0, limit) : messages
    
    // Reverse to get chronological order (oldest to newest)
    messagesToReturn.reverse()
   
    res.status(200).json({ 
      messages: messagesToReturn,
      hasMore: hasMore
      // Removed totalCount - expensive query that's not needed for pagination
      // Use hasMore flag instead
    })
   

}
    catch(error){
        res.status(500).json(error)
        console.log(error)
    }
}


export const mycon = async(req,res) => {
 
	try {
		const userId = req.user._id  // Fix: Use authenticated user's _id
   
    // Pagination parameters
    const limit = parseInt(req.query.limit) || 20 // Default to 20 conversations
    const beforeId = req.query.beforeId // Conversation ID to fetch conversations before (for pagination)
    
    // Build query
    let query = { participants: userId }
    
    // If beforeId is provided, fetch conversations updated before that conversation
    // CRITICAL: Use updatedAt to match our sort order, not createdAt
    if (beforeId) {
      const beforeConversation = await Conversation.findById(beforeId)
      if (beforeConversation) {
        query.updatedAt = { $lt: beforeConversation.updatedAt }
      }
    }
    
    // Get total count for pagination
    const totalCount = await Conversation.countDocuments({ participants: userId })
    
    // Fetch conversations with pagination
    const conversations = await Conversation.find(query)
      .populate({
        path: "participants",
        select: "username profilePic name inCall",
      })
      .sort({updatedAt: -1}) // Sort by updatedAt (last message time) instead of createdAt
      .limit(limit + 1) // Fetch one extra to check if there are more

    // Check if there are more conversations
    const hasMore = conversations.length > limit
    const conversationsToReturn = hasMore ? conversations.slice(0, limit) : conversations

    // Calculate unread counts and populate last message sender for each conversation
    const conversationsWithUnread = await Promise.all(
      conversationsToReturn.map(async (conversation) => {
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

        // Get the actual last message to populate sender info
        const lastMessageDoc = await Message.findOne({
          conversationId: conversation._id
        })
        .populate('sender', 'username name profilePic')
        .sort({ createdAt: -1 })
        .limit(1);

        // Convert to plain object and add unreadCount
        const convObj = conversation.toObject();
        convObj.unreadCount = unreadCount;
        
        // Update lastMessage with populated sender if we found a message
        if (lastMessageDoc) {
          convObj.lastMessage = {
            text: lastMessageDoc.text || '',
            sender: lastMessageDoc.sender,
            createdAt: lastMessageDoc.createdAt
          };
        } else if (convObj.lastMessage && convObj.lastMessage.sender) {
          // If lastMessage exists but sender is just an ID, populate it
          // Try to find sender in participants or fetch it
          const senderInParticipants = conversation.participants.find(
            p => p._id.toString() === (convObj.lastMessage.sender._id || convObj.lastMessage.sender).toString()
          );
          if (senderInParticipants) {
            convObj.lastMessage.sender = senderInParticipants;
          }
        }
        
        return convObj;
      })
    );

res.status(200).json({ 
  conversations: conversationsWithUnread, 
  hasMore,
  totalCount
});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
}


// Get total unread message count - OPTIMIZED endpoint
export const getTotalUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id
    
    // Get all conversations for this user
    const conversations = await Conversation.find({ participants: userId })
    
    // Count unread messages across all conversations
    let totalUnread = 0
    for (const conversation of conversations) {
      const unreadCount = await Message.countDocuments({
        conversationId: conversation._id,
        seen: false,
        sender: { $ne: userId }
      })
      totalUnread += unreadCount
    }
    
    res.status(200).json({ totalUnread })
  } catch (error) {
    console.log('Error getting total unread count:', error)
    res.status(500).json({ error: error.message })
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

// Delete a single message
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params
    const userId = req.user._id

    const message = await Message.findById(messageId)
    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // Check if user is a participant in the conversation (any participant can delete any message)
    const conversation = await Conversation.findById(message.conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const isParticipant = conversation.participants.some(
      participantId => participantId.toString() === userId.toString()
    )

    if (!isParticipant) {
      return res.status(403).json({ error: 'You can only delete messages in conversations you are part of' })
    }

    // Delete image/video from Cloudinary if it exists
    if (message.img && message.img.includes('cloudinary')) {
      try {
        // Determine resource type (image or video)
        const isVideo = message.img.includes('/video/upload/') || 
                       message.img.match(/\.(mp4|webm|ogg|mov)$/i) ||
                       (message.img.includes('cloudinary') && message.img.includes('video'))
        
        // Extract public ID from Cloudinary URL
        // URL format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{version}/{folder}/{filename}.{ext}
        // We need to extract: {folder}/{filename} (public ID)
        const urlParts = message.img.split('/')
        const uploadIndex = urlParts.findIndex(part => part === 'upload')
        
        if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
          // Get everything after 'upload' (skip version if present)
          let publicIdParts = urlParts.slice(uploadIndex + 1)
          
          // Remove version if it's a numeric v{timestamp}
          if (publicIdParts.length > 0 && /^v\d+$/.test(publicIdParts[0])) {
            publicIdParts = publicIdParts.slice(1)
          }
          
          // Join remaining parts to get public ID
          let publicId = publicIdParts.join('/')
          
          // Remove file extension
          publicId = publicId.replace(/\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|ogg|mov)$/i, '')
          
          // Delete from Cloudinary
          if (publicId) {
            await cloudinary.uploader.destroy(publicId, {
              resource_type: isVideo ? 'video' : 'image'
            })
            console.log(`Deleted ${isVideo ? 'video' : 'image'} from Cloudinary: ${publicId}`)
          }
        } else {
          // Fallback: try to extract public ID using simpler method
          const filename = urlParts[urlParts.length - 1]
          const publicId = filename.split('.')[0]
          if (publicId) {
            await cloudinary.uploader.destroy(publicId, {
              resource_type: isVideo ? 'video' : 'image'
            })
            console.log(`Deleted ${isVideo ? 'video' : 'image'} from Cloudinary (fallback): ${publicId}`)
          }
        }
      } catch (cloudinaryError) {
        // Log error but don't fail the message deletion
        console.error('Error deleting file from Cloudinary:', cloudinaryError)
        // Continue with message deletion even if Cloudinary deletion fails
      }
    }

    // Delete the message
    await Message.findByIdAndDelete(messageId)

    // Emit socket event to notify other participants (conversation already fetched above)
    if (conversation) {
      const io = getIO()
      if (io) {
        // Emit to all participants in the conversation
        conversation.participants.forEach(participantId => {
          io.emit("messageDeleted", { 
            conversationId: message.conversationId.toString(),
            messageId: messageId
          })
        })
      }
    }

    res.status(200).json({ message: 'Message deleted successfully' })
  } catch (error) {
    res.status(500).json({ error: error.message })
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