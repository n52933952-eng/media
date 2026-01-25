
import User from '../models/user.js'
import Post from '../models/post.js'
import Follow from '../models/follow.js'
import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'
import { getIO, getAllUserSockets } from '../socket/socket.js'


export const createPost = async(req,res) => {

    try{
  
        const{postedBy,text,isCollaborative,contributors}= req.body
         
      let img = ''


        if(!postedBy || !text){
            return res.status(400).json({error:"postedBy and text are requires"})
        }

      const user = await User.findById(postedBy)

       if(!user){
        return res.status(400).json({error:"now user"})
       } 

       if(user._id.toString() !== req.user._id.toString()){
        return res.status(400).json({error:"unthorized"})
       }

       const MaxLength = 500 

       if(text.length > MaxLength){
        return res.status(500).json({error:"post text must be 500 or less"})
       }

       // Handle file upload via Multer to Cloudinary
       if(req.file) {
         return new Promise((resolve, reject) => {
           const stream = cloudinary.uploader.upload_stream(
             {
               resource_type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
               folder: 'posts',
               timeout: 1200000,
               chunk_size: 6000000,
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
                 const postData = {postedBy,text,img}
                 if (isCollaborative) {
                   postData.isCollaborative = true
                   postData.contributors = contributors && Array.isArray(contributors) ? contributors : [postedBy]
                 }
                 const newPost = new Post(postData)
                 await newPost.save()
                 
                 // Populate postedBy for socket emission
                 await newPost.populate("postedBy", "username profilePic name")
                 
                 // OPTIMIZED: Emit new post only to online followers (not all users)
                 const io = getIO()
                 if (io) {
                   // Read-from-Follow: Get poster's followers (cap for safety)
                   const followerDocs = await Follow.find({ followeeId: postedBy })
                     .select('followerId')
                     .limit(10000)
                     .lean()
                   if (followerDocs && followerDocs.length > 0) {
                     const socketMap = await getAllUserSockets()
                     const onlineFollowers = []
                     
                     followerDocs.forEach(d => {
                       const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                       const socketData = socketMap[followerIdStr]
                       if (socketData && socketData.socketId) {
                         onlineFollowers.push(socketData.socketId)
                       }
                     })
                     
                     // Only emit to online followers (not all users)
                     if (onlineFollowers.length > 0) {
                       io.to(onlineFollowers).emit("newPost", newPost)
                     }
                   }
                 }
               
               // Create activity for activity feed
               const { createActivity } = await import('./activity.js')
               createActivity(postedBy, 'post', {
                   postId: newPost._id,
                   metadata: { text: text.substring(0, 50), hasImage: !!img }
               }).catch(err => {
                   console.error('Error creating activity:', err)
               })
               
               if (!res.headersSent) {
                 res.status(200).json({message:"post created sufully", post: newPost})
               }
               resolve()
              } catch (error) {
                 console.error('Error creating post after upload:', error)
                 if (!res.headersSent) {
                   res.status(500).json({ 
                     error: error.message || 'Failed to create post. Please try again.' 
                   })
                 }
                 reject(error)
               }
             }
           )
           
           const bufferStream = new Readable()
           bufferStream.push(req.file.buffer)
           bufferStream.push(null)
           bufferStream.pipe(stream)
         })
       }

       // No file - create post immediately
       const postData = {postedBy,text,img}
       if (isCollaborative) {
         postData.isCollaborative = true
         postData.contributors = contributors && Array.isArray(contributors) ? contributors : [postedBy]
       }
       const newPost = new Post(postData)
       await newPost.save()
       
       // Populate postedBy for socket emission
       await newPost.populate("postedBy", "username profilePic name")
       
       // OPTIMIZED: Emit new post only to online followers (not all users)
       const io = getIO()
       if (io) {
         // Read-from-Follow: Get poster's followers (cap for safety)
         const followerDocs = await Follow.find({ followeeId: postedBy })
           .select('followerId')
           .limit(10000)
           .lean()
         if (followerDocs && followerDocs.length > 0) {
           const socketMap = await getAllUserSockets()
           const onlineFollowers = []
           
           followerDocs.forEach(d => {
             const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
             const socketData = socketMap[followerIdStr]
             if (socketData && socketData.socketId) {
               onlineFollowers.push(socketData.socketId)
             }
           })
           
           // Only emit to online followers (not all users)
           if (onlineFollowers.length > 0) {
             io.to(onlineFollowers).emit("newPost", newPost)
           }
         }
       }
       
       res.status(200).json({message:"post created sufully", post: newPost})

    }
    catch(error){
        console.log(error)
        res.status(500).json(error)
    }
}






export const getPost = async(req,res) => {

   
    try{

        const post = await Post.findById(req.params.id)
            .populate("postedBy", "username profilePic name")
            .populate("contributors", "username profilePic name")

        if(!post){
            return res.status(500).json({message:"no post"})
        }
  
      res.status(200).json(post)

    }
    catch(error){
        res.status(500).json(error)
    }


}





// Update post (allows owner or contributors for collaborative posts)
export const updatePost = async(req,res) => {
    try{
        const { id } = req.params
        const { text } = req.body
        const userId = req.user._id
        
        // Fetch post without populating postedBy (we need the ObjectId, not the object)
        const post = await Post.findById(id)
            .populate('contributors', '_id')
            .select('+postedBy') // Ensure postedBy is included
        
        if(!post){
            return res.status(400).json({error:"Post not found"})
        }
        
        // Get post owner ID BEFORE populating - use Mongoose's lean or direct access
        // postedBy should be ObjectId, but handle if it's already populated
        let postOwnerId
        try {
            // Try to get the _id if it's populated, otherwise it's already an ObjectId
            if (post.postedBy && post.postedBy._id) {
                // Already populated
                postOwnerId = post.postedBy._id.toString()
            } else if (post.postedBy && post.postedBy.toString) {
                // ObjectId - call toString() directly (not String() which might serialize the object)
                postOwnerId = post.postedBy.toString()
            } else {
                // Fallback
                postOwnerId = String(post.postedBy)
            }
            // Validate it's a proper ObjectId string (24 hex chars)
            if (!/^[0-9a-fA-F]{24}$/.test(postOwnerId)) {
                throw new Error('Invalid ObjectId format')
            }
        } catch (err) {
            console.error('⚠️ Error extracting postOwnerId:', err, 'postedBy:', post.postedBy)
            // If all else fails, get the raw value from the document
            const rawPost = post.toObject ? post.toObject() : post
            postOwnerId = rawPost.postedBy?.toString() || String(rawPost.postedBy)
        }
        
        // Check if user is owner
        const isOwner = postOwnerId === userId.toString()
        
        // Check if user is a contributor (for collaborative posts)
        const isContributor = post.isCollaborative && 
            post.contributors && 
            post.contributors.some(c => (c._id || c).toString() === userId.toString())
        
        if(!isOwner && !isContributor){
            return res.status(403).json({error:"You can only edit your own posts or collaborative posts you contribute to"})
        }
        
        // Validate text length
        const MaxLength = 500
        if(text && text.length > MaxLength){
            return res.status(400).json({error:"Post text must be 500 characters or less"})
        }
        
        // Handle file upload if new file is provided
        let img = post.img // Keep existing image by default
        
        if(req.file) {
            // Delete old image/video from Cloudinary if it exists
            if(post.img && post.img.includes('cloudinary')){
                try {
                    const isVideo = post.img.includes('/video/upload/') || 
                                   post.img.match(/\.(mp4|webm|ogg|mov)$/i) ||
                                   (post.img.includes('cloudinary') && post.img.includes('video'))
                    
                    const urlParts = post.img.split('/')
                    const uploadIndex = urlParts.findIndex(part => part === 'upload')
                    
                    if(uploadIndex !== -1 && uploadIndex < urlParts.length - 1){
                        let publicIdParts = urlParts.slice(uploadIndex + 1)
                        // Remove file extension for public ID
                        const publicId = publicIdParts.join('/').replace(/\.[^/.]+$/, '')
                        
                        await cloudinary.uploader.destroy(publicId, {
                            resource_type: isVideo ? 'video' : 'image'
                        })
                        console.log(`✅ Deleted old ${isVideo ? 'video' : 'image'} from Cloudinary: ${publicId}`)
                    }
                } catch (cloudinaryError) {
                    console.error('Error deleting old file from Cloudinary:', cloudinaryError)
                    // Continue with update even if old file deletion fails
                }
            }
            
            // Upload new file
            return new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        resource_type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
                        folder: 'posts',
                        timeout: 1200000,
                        chunk_size: 6000000,
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
                        
                        // Update post
                        post.text = text || post.text
                        post.img = img
                        await post.save()
                        
                        // Populate for response
                        await post.populate("postedBy", "username profilePic name")
                        await post.populate("contributors", "username profilePic name")
                        
                        // Notify post owner if a contributor edited the post
                        const isContributorEdit = !isOwner && isContributor
                        if (isContributorEdit) {
                            try {
                                const { createNotification } = await import('./notification.js')
                                // Use postOwnerId we got earlier (before populate)
                                await createNotification(postOwnerId, 'post_edit', userId.toString(), {
                                    postId: post._id.toString(),
                                    postText: post.text?.substring(0, 50) || 'your collaborative post'
                                })
                                console.log(`📬 [updatePost] Created edit notification for post owner ${postOwnerId}`)
                            } catch (err) {
                                console.error('❌ [updatePost] Error creating edit notification:', err)
                            }
                        }
                        
                        // Notify all contributors if the owner edited the post
                        const isOwnerEdit = isOwner && post.isCollaborative && post.contributors && post.contributors.length > 0
                        if (isOwnerEdit) {
                            try {
                                const { createNotification } = await import('./notification.js')
                                // Notify each contributor
                                for (const contributor of post.contributors) {
                                    const contributorId = (contributor._id || contributor).toString()
                                    if (contributorId !== userId.toString()) { // Don't notify yourself
                                        await createNotification(contributorId, 'post_edit', userId.toString(), {
                                            postId: post._id.toString(),
                                            postText: post.text?.substring(0, 50) || 'your collaborative post'
                                        })
                                        console.log(`📬 [updatePost] Created edit notification for contributor ${contributorId}`)
                                    }
                                }
                            } catch (err) {
                                console.error('❌ [updatePost] Error creating contributor edit notifications:', err)
                            }
                        }
                        
                        // Emit update to followers, post owner, and all contributors
                        const io = getIO()
                        if (io) {
                            const userSocketMap = await getAllUserSockets()
                            const recipients = [] // Socket IDs to receive the update
                            
                            // 1. Add post owner (always include them) - use postOwnerId we got earlier
                            const ownerSocketData = userSocketMap[postOwnerId]
                            if (ownerSocketData) {
                                recipients.push(ownerSocketData.socketId)
                                console.log(`📤 [updatePost] Adding post owner ${postOwnerId} to postUpdated recipients`)
                            }
                            
                            // 2. Add all contributors
                            if (post.contributors && post.contributors.length > 0) {
                                post.contributors.forEach(contributor => {
                                    const contributorId = (contributor._id || contributor).toString()
                                    if (contributorId !== postOwnerId) { // Don't duplicate owner
                                        const contributorSocketData = userSocketMap[contributorId]
                                        if (contributorSocketData) {
                                            recipients.push(contributorSocketData.socketId)
                                            console.log(`📤 [updatePost] Adding contributor ${contributorId} to postUpdated recipients`)
                                        }
                                    }
                                })
                            }
                            
                            // 3. Add followers
                            const followerDocs = await Follow.find({ followeeId: postOwnerId })
                              .select('followerId')
                              .limit(10000)
                              .lean()
                            if (followerDocs && followerDocs.length > 0) {
                                followerDocs.forEach(d => {
                                    const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                                    // Don't duplicate owner/contributors
                                    if (followerIdStr !== postOwnerId && 
                                        !post.contributors?.some(c => (c._id || c).toString() === followerIdStr)) {
                                        const followerSocketData = userSocketMap[followerIdStr]
                                        if (followerSocketData) {
                                            recipients.push(followerSocketData.socketId)
                                        }
                                    }
                                })
                            }
                            
                            // Emit to all recipients (owner, contributors, followers)
                            const uniqueRecipients = [...new Set(recipients)] // Remove duplicates
                            if (uniqueRecipients.length > 0) {
                                // Convert Mongoose document to plain object for socket emission
                                const postObj = post.toObject ? post.toObject() : JSON.parse(JSON.stringify(post))
                                uniqueRecipients.forEach(socketId => {
                                    io.to(socketId).emit("postUpdated", { postId: post._id.toString(), post: postObj })
                                })
                                console.log(`📤 [updatePost] Emitted postUpdated to ${uniqueRecipients.length} recipients (owner, contributors, followers)`)
                            } else {
                                console.log(`⚠️ [updatePost] No recipients found for post update (post owner ${postOwnerId} might not be online)`)
                            }
                        }
                        
                        if (!res.headersSent) {
                            res.status(200).json({message:"Post updated successfully", post})
                        }
                        resolve()
                    }
                )
                
                const bufferStream = new Readable()
                bufferStream.push(req.file.buffer)
                bufferStream.push(null)
                bufferStream.pipe(stream)
            })
        }
        
        // No file upload - just update text
        post.text = text || post.text
        await post.save()
        
        // Populate for response
        await post.populate("postedBy", "username profilePic name")
        await post.populate("contributors", "username profilePic name")
        
        // Notify post owner if a contributor edited the post
        const isContributorEdit = !isOwner && isContributor
        if (isContributorEdit) {
            try {
                const { createNotification } = await import('./notification.js')
                // Use postOwnerId we got earlier (before populate)
                await createNotification(postOwnerId, 'post_edit', userId.toString(), {
                    postId: post._id.toString(),
                    postText: post.text?.substring(0, 50) || 'your collaborative post'
                })
                console.log(`📬 [updatePost] Created edit notification for post owner ${postOwnerId}`)
            } catch (err) {
                console.error('❌ [updatePost] Error creating edit notification:', err)
            }
        }
        
        // Notify all contributors if the owner edited the post
        const isOwnerEdit = isOwner && post.isCollaborative && post.contributors && post.contributors.length > 0
        if (isOwnerEdit) {
            try {
                const { createNotification } = await import('./notification.js')
                // Notify each contributor
                for (const contributor of post.contributors) {
                    const contributorId = (contributor._id || contributor).toString()
                    if (contributorId !== userId.toString()) { // Don't notify yourself
                        await createNotification(contributorId, 'post_edit', userId.toString(), {
                            postId: post._id.toString(),
                            postText: post.text?.substring(0, 50) || 'your collaborative post'
                        })
                        console.log(`📬 [updatePost] Created edit notification for contributor ${contributorId}`)
                    }
                }
            } catch (err) {
                console.error('❌ [updatePost] Error creating contributor edit notifications:', err)
            }
        }
        
        // Emit update to followers, post owner, and all contributors
        const io = getIO()
        if (io) {
            const userSocketMap = await getAllUserSockets()
            const recipients = [] // Socket IDs to receive the update
            
            // 1. Add post owner (always include them) - use postOwnerId we got earlier
            const ownerSocketData = userSocketMap[postOwnerId]
            if (ownerSocketData) {
                recipients.push(ownerSocketData.socketId)
                console.log(`📤 [updatePost] Adding post owner ${postOwnerId} to postUpdated recipients`)
            }
            
            // 2. Add all contributors
            if (post.contributors && post.contributors.length > 0) {
                post.contributors.forEach(contributor => {
                    const contributorId = (contributor._id || contributor).toString()
                    if (contributorId !== postOwnerId) { // Don't duplicate owner
                        const contributorSocketData = userSocketMap[contributorId]
                        if (contributorSocketData) {
                            recipients.push(contributorSocketData.socketId)
                            console.log(`📤 [updatePost] Adding contributor ${contributorId} to postUpdated recipients`)
                        }
                    }
                })
            }
            
            // 3. Add followers
            const followerDocs = await Follow.find({ followeeId: postOwnerId })
              .select('followerId')
              .limit(10000)
              .lean()
            if (followerDocs && followerDocs.length > 0) {
                followerDocs.forEach(d => {
                    const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                    // Don't duplicate owner/contributors
                    if (followerIdStr !== postOwnerId && 
                        !post.contributors?.some(c => (c._id || c).toString() === followerIdStr)) {
                        const followerSocketData = userSocketMap[followerIdStr]
                        if (followerSocketData) {
                            recipients.push(followerSocketData.socketId)
                        }
                    }
                })
            }
            
            // Emit to all recipients (owner, contributors, followers)
            const uniqueRecipients = [...new Set(recipients)] // Remove duplicates
            if (uniqueRecipients.length > 0) {
                // Convert Mongoose document to plain object for socket emission
                const postObj = post.toObject ? post.toObject() : JSON.parse(JSON.stringify(post))
                uniqueRecipients.forEach(socketId => {
                    io.to(socketId).emit("postUpdated", { postId: post._id.toString(), post: postObj })
                })
                console.log(`📤 [updatePost] Emitted postUpdated to ${uniqueRecipients.length} recipients (owner, contributors, followers)`)
            } else {
                console.log(`⚠️ [updatePost] No recipients found for post update (post owner ${postOwnerId} might not be online)`)
            }
        }
        
        res.status(200).json({message:"Post updated successfully", post})
    }
    catch(error){
        console.error('Error updating post:', error)
        res.status(500).json({error: error.message || "Failed to update post"})
    }
}

export const deletePost = async(req,res) => {
    try{
      const post = await Post.findById(req.params.id)

      if(!post){
        return res.status(400).json({message:"no post"})
      }

      // Allow deletion if:
      // 1. User is the post author, OR
      // 2. User added this channel post (channelAddedBy matches)
      const isPostAuthor = post.postedBy.toString() === req.user._id.toString()
      const isChannelPostAddedByUser = post.channelAddedBy && post.channelAddedBy === req.user._id.toString()
      
      if(!isPostAuthor && !isChannelPostAddedByUser){
        return res.status(400).json({message:"you cant delete other users post"})
      }

      // Delete image/video from Cloudinary if it exists
      if(post.img && post.img.includes('cloudinary')){
        try {
          // Determine resource type (image or video)
          const isVideo = post.img.includes('/video/upload/') || 
                         post.img.match(/\.(mp4|webm|ogg|mov)$/i) ||
                         (post.img.includes('cloudinary') && post.img.includes('video'))
          
          // Extract public ID from Cloudinary URL
          // URL format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{version}/{folder}/{filename}.{ext}
          // We need to extract: {folder}/{filename} (public ID)
          const urlParts = post.img.split('/')
          const uploadIndex = urlParts.findIndex(part => part === 'upload')
          
          if(uploadIndex !== -1 && uploadIndex < urlParts.length - 1){
            // Get everything after 'upload' (skip version if present)
            let publicIdParts = urlParts.slice(uploadIndex + 1)
            
            // Remove version if it's a numeric v{timestamp}
            if(publicIdParts.length > 0 && /^v\d+$/.test(publicIdParts[0])){
              publicIdParts = publicIdParts.slice(1)
            }
            
            // Join remaining parts to get public ID
            let publicId = publicIdParts.join('/')
            
            // Remove file extension
            publicId = publicId.replace(/\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|ogg|mov)$/i, '')
            
            // Delete from Cloudinary
            if(publicId){
              await cloudinary.uploader.destroy(publicId, {
                resource_type: isVideo ? 'video' : 'image'
              })
              console.log(`Deleted ${isVideo ? 'video' : 'image'} from Cloudinary: ${publicId}`)
            }
          } else {
            // Fallback: try to extract public ID using simpler method
            const filename = urlParts[urlParts.length - 1]
            const publicId = filename.split('.')[0]
            if(publicId){
              await cloudinary.uploader.destroy(publicId, {
                resource_type: isVideo ? 'video' : 'image'
              })
              console.log(`Deleted ${isVideo ? 'video' : 'image'} from Cloudinary (fallback): ${publicId}`)
            }
          }
        } catch (cloudinaryError) {
          // Log error but don't fail the post deletion
          console.error('Error deleting file from Cloudinary:', cloudinaryError)
          // Continue with post deletion even if Cloudinary deletion fails
        }
      }

      // OPTIMIZED: Get followers before deleting post
      const postAuthorId = post.postedBy.toString()
      const followerDocs = await Follow.find({ followeeId: postAuthorId })
        .select('followerId')
        .limit(10000)
        .lean()
      
      // Delete the post from MongoDB
      await Post.findByIdAndDelete(req.params.id)

      // OPTIMIZED: Emit post deleted only to online followers
      const io = getIO()
      if (io && followerDocs && followerDocs.length > 0) {
        const userSocketMap = await getAllUserSockets()
        const onlineFollowers = []
        
        followerDocs.forEach(d => {
          const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
          if (userSocketMap[followerIdStr]) {
            onlineFollowers.push(userSocketMap[followerIdStr].socketId)
          }
        })
        
        if (onlineFollowers.length > 0) {
          io.to(onlineFollowers).emit("postDeleted", { postId: req.params.id })
        }
      }

      res.status(200).json({message:"post has deleted sucsfully"})
    }
    catch(error){
        console.log(error)
        res.status(500).json(error)
    }
}




export const LikePost = async(req,res) => {

    try{

     const{id} = req.params 
     const userId = req.user._id 
  
     const post = await Post.findById(id)
     
     if(!post){
        return res.status(400).json({message:"no post found"})
     }
    
     const isUserLikedPost = post.likes.includes(userId)

     if(isUserLikedPost){
         await Post.updateOne({_id:id},{$pull:{likes:userId}})
         res.status(200).json({message:"post unlike scfully"})
     }else{
      post.likes.push(userId)
      await post.save()
      
      // Create notification for post owner when someone likes their post
      // Don't notify if user is liking their own post
      if (post.postedBy.toString() !== userId.toString()) {
          const { createNotification } = await import('./notification.js')
          createNotification(post.postedBy, 'like', userId, {
              postId: post._id
          }).catch(err => {
              console.error('Error creating like notification:', err)
          })
      }
      
      // Create activity for activity feed
      const { createActivity } = await import('./activity.js')
      createActivity(userId, 'like', {
          postId: post._id,
          targetUser: post.postedBy,
          metadata: { postText: post.text?.substring(0, 50) || '' }
      }).catch(err => {
          console.error('Error creating activity:', err)
      })
      
      res.status(200).json({message:"post liked scfully"})
     }

   
    }
    catch(error){
        console.log(error)
        res.status(500).json(error)
    }
}






export const ReplyPost = async(req,res) => {

    try{
  
        const{text}= req.body
        const username = req.user.username
        const userId = req.user._id 
        const id = req.params.id 
        const userProfilePic = req.user.profilePic 

        const post = await Post.findById(id)

        if(!post){
            return res.status(400).json({message:"no post"})
        }
     
        const reply = {
            text,
            username,
            userId,
            userProfilePic,
            likes: []  // Initialize likes array
        }

        post.replies.push(reply)

        await post.save()

        // Return the saved reply (it will have _id and all fields after saving)
        const savedReply = post.replies[post.replies.length - 1]
        
        // Create notifications
        const { createNotification } = await import('./notification.js')
        const User = (await import('../models/user.js')).default
        
        // 1. Notify post owner if commenter is not the post owner
        if (post.postedBy.toString() !== userId.toString()) {
            createNotification(post.postedBy, 'comment', userId, {
                postId: post._id,
                commentText: text
            }).catch(err => {
                console.error('Error creating comment notification:', err)
            })
        }
        
        // Create activity for activity feed
        const { createActivity } = await import('./activity.js')
        createActivity(userId, 'comment', {
            postId: post._id,
            targetUser: post.postedBy,
            metadata: { commentText: text.substring(0, 50) }
        }).catch(err => {
            console.error('Error creating activity:', err)
        })
        
        // 2. Check for @mentions in the comment text (e.g., @username)
        const mentionRegex = /@(\w+)/g
        const mentions = text.match(mentionRegex)
        if (mentions) {
            const mentionedUsernames = [...new Set(mentions.map(m => m.substring(1)))] // Remove @ and get unique usernames
            
            for (const username of mentionedUsernames) {
                try {
                    const mentionedUser = await User.findOne({ username })
                    if (mentionedUser && mentionedUser._id.toString() !== userId.toString() && mentionedUser._id.toString() !== post.postedBy.toString()) {
                        // Don't notify if they're the commenter or post owner (already notified above)
                        createNotification(mentionedUser._id, 'mention', userId, {
                            postId: post._id,
                            commentText: text
                        }).catch(err => {
                            console.error('Error creating mention notification:', err)
                        })
                    }
                } catch (err) {
                    console.error('Error finding mentioned user:', err)
                }
            }
        }
        
        res.status(200).json(savedReply)

    }
    catch(error){
        console.log(error)
        res.status(500).json(error)
    }
}







export const getFeedPost = async(req,res) => {
    try{
        const userId = req.user._id 
        // Read-from-Follow: get following list (cap for safety)
        const followingDocs = await Follow.find({ followerId: userId })
            .select('followeeId')
            .limit(5000)
            .lean()
        const following = followingDocs.map(d => d.followeeId)
        
        // If user follows no one, return empty feed
        if (following.length === 0) {
            return res.status(200).json({ 
                posts: [],
                hasMore: false,
                totalCount: 0
            })
        }
        
        // Pagination parameters
        const limit = parseInt(req.query.limit) || 10 // Default to 10 posts per page
        const skip = parseInt(req.query.skip) || 0 // Skip for pagination
        
        // Get Football account and check if user follows it
        const footballAccount = await User.findOne({ username: 'Football' }).select('_id')
        // Check if user follows Football - convert all to strings for reliable comparison
        const followsFootball = footballAccount && following.some(followId => {
            return followId.toString() === footballAccount._id.toString()
        })
        
        // Strategy: Always include Football and channel posts in first page, sorted with normal posts
        // For first page (skip=0): Get normal posts + always include Football + channels
        // For subsequent pages: Get normal posts only (Football and channels already shown on page 1)
        
        // OPTIMIZED: Fetch only the last 3 posts from each followed user
        const postsPerUser = 3
        const followedUserIds = following.filter(id => id.toString() !== userId.toString())
        
        // Get 3 most recent posts from each followed user
        const postsPromises = followedUserIds.map(async (followedUserId) => {
            const userPosts = await Post.find({ postedBy: followedUserId })
                .populate("postedBy", "-password")
                .populate("contributors", "username profilePic name")
                .sort({ createdAt: -1 })
                .limit(postsPerUser)
            return userPosts
        })
        
        // Get channel posts that this user added
        const channelPostsPromise = Post.find({ 
            channelAddedBy: userId.toString() 
        })
            .populate("postedBy", "-password")
            .populate("contributors", "username profilePic name")
            .sort({ createdAt: -1 })
            .limit(20) // Get all channel posts user added
        
        // Get Football post if user follows Football
        // Get the latest post from Football account (works for both live matches and "no matches" posts)
        let footballPostsPromise = Promise.resolve([])
        if (followsFootball && footballAccount) {
            footballPostsPromise = Post.find({ 
                postedBy: footballAccount._id
            })
                .populate("postedBy", "-password")
                .populate("contributors", "username profilePic name")
                .sort({ createdAt: -1 })
                .limit(1)
        }
        
        // Wait for all posts to be fetched
        const [allPostsArrays, channelPosts, footballPosts] = await Promise.all([
            Promise.all(postsPromises),
            channelPostsPromise,
            footballPostsPromise
        ])
        
        // SIMPLE APPROACH: 
        // 1. Get 3 newest posts from each followed user
        // 2. Combine with Football and channel posts
        // 3. Sort ALL together by createdAt (newest first)
        // 4. First page: Football + Channels + 12 normal posts (all sorted together)
        // 5. Subsequent pages: Only normal posts
        
        // Separate normal posts from Football and channels
        let allNormalPosts = allPostsArrays.flat()
        
        // Sort normal posts by createdAt (newest first)
        allNormalPosts.sort((a, b) => {
            const dateA = new Date(a.createdAt).getTime()
            const dateB = new Date(b.createdAt).getTime()
            return dateB - dateA // Newest first
        })
        
        // Remove duplicates from normal posts
        const uniqueNormalPosts = []
        const seenPostIds = new Set()
        for (const post of allNormalPosts) {
            const postId = post._id.toString()
            if (!seenPostIds.has(postId)) {
                uniqueNormalPosts.push(post)
                seenPostIds.add(postId)
            }
        }
        
        // For first page (skip=0): Football + Channels + 12 normal posts (all sorted together)
        if (skip === 0) {
            // Get top 12 normal posts
            const topNormalPosts = uniqueNormalPosts.slice(0, 12)
            
            // Combine: Football + Channels + 12 normal posts
            const combinedPosts = []
            if (footballPosts.length > 0) {
                combinedPosts.push(footballPosts[0])
            }
            combinedPosts.push(...channelPosts)
            combinedPosts.push(...topNormalPosts)
            
            // Sort ALL together by updatedAt (or createdAt if no updatedAt) - this makes the feed dynamic!
            // Football post will move to top when scores update (updatedAt changes)
            combinedPosts.sort((a, b) => {
                const dateA = new Date(a.updatedAt || a.createdAt).getTime()
                const dateB = new Date(b.updatedAt || b.createdAt).getTime()
                return dateB - dateA // Newest first
            })
            
            // Calculate hasMore: true if there are more than 12 normal posts
            const hasMore = uniqueNormalPosts.length > 12
            
            return res.status(200).json({ 
                posts: combinedPosts,
                hasMore,
                totalCount: uniqueNormalPosts.length
            })
        }
        
        // For subsequent pages: Only return normal posts (no Football or channels)
        // Skip the first 12 normal posts (already shown on page 1)
        const startIndex = skip
        const endIndex = startIndex + limit
        const paginatedPosts = uniqueNormalPosts.slice(startIndex, endIndex)
        const hasMore = endIndex < uniqueNormalPosts.length
        const totalCount = uniqueNormalPosts.length
        
        console.log(`📄 [getFeedPost] Page ${Math.floor(skip / limit) + 1}: Returning ${paginatedPosts.length} posts (skip: ${skip}, limit: ${limit}, hasMore: ${hasMore}, totalCount: ${totalCount})`)
        
        return res.status(200).json({ 
            posts: paginatedPosts,
            hasMore,
            totalCount
        })
    }
    catch(error){
        console.error('Error in getFeedPost:', error)
        res.status(500).json({error: error.message || "Failed to fetch feed posts"})
    }
}








// Get posts by user ID (for fetching newly followed user's posts)
export const getUserPostsById = async(req,res)=>{
    try{
        const{userId}= req.params 

        if(!userId){
            return res.status(400).json({error:"userId is required"})
        }

        // Pagination parameters
        const limit = parseInt(req.query.limit) || 3 // Default to 3 posts (for feed)
        const skip = parseInt(req.query.skip) || 0
        
        const posts = await Post.find({postedBy:userId})
            .populate("postedBy","-password")
            .populate("contributors", "username profilePic name")
            .sort({createdAt:-1})
            .limit(limit)
            .skip(skip)
            
        res.status(200).json({ 
            posts: posts || [],
            hasMore: false, // Not needed for feed integration
            totalCount: posts.length
        })
    }
    catch(error){
        res.status(500).json({error: error.message || "Failed to fetch user posts"})
    }
}

export const getUserPosts = async(req,res)=>{

    try{
 
        const{username}= req.params 

        const user = await User.findOne({username})

         if(!user){
            return res.status(400).json({error:"no user"})
         }

         // Pagination parameters
         const limit = parseInt(req.query.limit) || 10 // Default to 10 posts per page
         const skip = parseInt(req.query.skip) || 0 // Skip for pagination
         
         const posts = await Post.find({postedBy:user._id})
            .populate("postedBy","-password")
            .populate("contributors", "username profilePic name")
            .sort({createdAt:-1})
            .limit(limit)
            .skip(skip)
            
         // Check if there are more posts
         const totalCount = await Post.countDocuments({postedBy:user._id})
         const hasMore = (skip + limit) < totalCount

         res.status(200).json({ 
             posts,
             hasMore,
             totalCount
         })

    }catch(error){
        console.log(error)
    }
}













export const ReplyToComment = async(req, res) => {
    try {
        const { text, parentReplyId } = req.body  // parentReplyId is the _id of the comment being replied to
        const { id } = req.params  // This is the post ID
        const username = req.user.username
        const userId = req.user._id
        const userProfilePic = req.user.profilePic

        const post = await Post.findById(id)
        
        if(!post) {
            return res.status(400).json({message: "no post"})
        }

        // NEW: Extract mentioned user - if replying to a comment, mention that person
        // This stores who was mentioned (like @username on Facebook)
        let mentionedUser = null
        if (parentReplyId) {
            // Find the parent comment/reply that's being replied to
            const parentReply = post.replies.id(parentReplyId)
            if (parentReply) {
                // The person being replied to is automatically mentioned
                mentionedUser = {
                    userId: parentReply.userId,
                    username: parentReply.username
                }
            }
        }

        // Create the reply object
        const reply = {
            text,
            username,
            userId,
            userProfilePic,
            parentReplyId: parentReplyId || null,  // If parentReplyId exists, it's a nested reply
            mentionedUser: mentionedUser,  // NEW: Save who was mentioned (@username)
            likes: []  // Initialize likes array
        }

        post.replies.push(reply)
        await post.save()

        // Return the newly created reply (it will have _id after saving)
        const newReply = post.replies[post.replies.length - 1]
        
        // Create notifications
        const { createNotification } = await import('./notification.js')
        const User = (await import('../models/user.js')).default
        
        // Track who we've already notified to avoid duplicates
        const notifiedUsers = new Set()
        notifiedUsers.add(userId.toString()) // Don't notify the commenter
        
        // 1. Notify post owner if commenter is not the post owner
        if (post.postedBy.toString() !== userId.toString()) {
            notifiedUsers.add(post.postedBy.toString())
            createNotification(post.postedBy, 'comment', userId, {
                postId: post._id,
                commentText: text
            }).catch(err => {
                console.error('Error creating comment notification:', err)
            })
        }
        
        // 2. Notify mentioned user (if replying to a comment, the parent comment author is mentioned)
        if (mentionedUser && mentionedUser.userId && mentionedUser.userId.toString() !== userId.toString()) {
            if (!notifiedUsers.has(mentionedUser.userId.toString())) {
                notifiedUsers.add(mentionedUser.userId.toString())
                createNotification(mentionedUser.userId, 'mention', userId, {
                    postId: post._id,
                    commentText: text
                }).catch(err => {
                    console.error('Error creating mention notification:', err)
                })
            }
        }
        
        // 3. Check for @mentions in the comment text (e.g., @username)
        const mentionRegex = /@(\w+)/g
        const mentions = text.match(mentionRegex)
        if (mentions) {
            const mentionedUsernames = [...new Set(mentions.map(m => m.substring(1)))] // Remove @ and get unique usernames
            
            for (const username of mentionedUsernames) {
                try {
                    const mentionedUser = await User.findOne({ username })
                    if (mentionedUser && !notifiedUsers.has(mentionedUser._id.toString())) {
                        notifiedUsers.add(mentionedUser._id.toString())
                        createNotification(mentionedUser._id, 'mention', userId, {
                            postId: post._id,
                            commentText: text
                        }).catch(err => {
                            console.error('Error creating mention notification:', err)
                        })
                    }
                } catch (err) {
                    console.error('Error finding mentioned user:', err)
                }
            }
        }
        
        res.status(200).json(newReply)
    }
    catch(error) {
        console.log(error)
        res.status(500).json(error)
    }
}








// Create chess game post when two players start a game
export const createChessGamePost = async (player1Id, player2Id, roomId) => {
    try {
        // Get both players' info
        const player1 = await User.findById(player1Id).select('username name profilePic')
        const player2 = await User.findById(player2Id).select('username name profilePic')
        
        if (!player1 || !player2) {
            console.error('❌ [createChessGamePost] Player not found:', { player1Id, player2Id })
            return null
        }
        
        // Create chess game data
        const chessGameData = {
            player1: {
                _id: player1._id.toString(),
                username: player1.username,
                name: player1.name,
                profilePic: player1.profilePic
            },
            player2: {
                _id: player2._id.toString(),
                username: player2.username,
                name: player2.name,
                profilePic: player2.profilePic
            },
            roomId: roomId,
            gameStatus: 'active', // active, ended, canceled
            createdAt: new Date()
        }
        
        // Create posts for both players (so followers of either see it)
        const posts = []
        
        // Post from player1's perspective
        const post1 = new Post({
            postedBy: player1Id,
            text: `Playing chess with ${player2.name} ♟️`,
            chessGameData: JSON.stringify(chessGameData)
        })
        await post1.save()
        await post1.populate("postedBy", "username profilePic name")
        posts.push(post1)
        
        // Post from player2's perspective (if different from player1)
        if (player1Id.toString() !== player2Id.toString()) {
            const post2 = new Post({
                postedBy: player2Id,
                text: `Playing chess with ${player1.name} ♟️`,
                chessGameData: JSON.stringify(chessGameData)
            })
            await post2.save()
            await post2.populate("postedBy", "username profilePic name")
            posts.push(post2)
        }
        
        console.log('✅ [createChessGamePost] Created chess game posts:', posts.map(p => p._id))
        
        // Emit newPost event to online followers of each post's author (not both players)
        // Each post should only go to followers of that specific post's author
        const io = getIO()
        console.log('🔍 [createChessGamePost] Checking IO instance:', !!io)
        
        if (io) {
            const userSocketMap = await getAllUserSockets()
            console.log('🔍 [createChessGamePost] User socket map size:', Object.keys(userSocketMap).length)
            
            // Emit each post only to followers of that post's author
            for (const post of posts) {
                // Get the author ID - handle both ObjectId and populated object
                // Since we populated postedBy above, it's an object with _id
                let postAuthorId
                if (post.postedBy && typeof post.postedBy === 'object') {
                    // If postedBy is populated (object with _id)
                    postAuthorId = post.postedBy._id ? post.postedBy._id.toString() : post.postedBy.toString()
                } else {
                    // If postedBy is just an ObjectId
                    postAuthorId = post.postedBy.toString()
                }
                
                if (!postAuthorId) {
                    console.error(`❌ [createChessGamePost] Post ${post._id} has invalid postedBy field:`, post.postedBy)
                    continue
                }
                
                console.log(`🔍 [createChessGamePost] Post author ID: ${postAuthorId}`)
                
                // Get followers of this specific post's author
                const followerDocs = await Follow.find({ followeeId: postAuthorId })
                  .select('followerId')
                  .limit(10000)
                  .lean()
                
                if (!followerDocs || followerDocs.length === 0) {
                    console.log(`ℹ️ [createChessGamePost] Post author ${postAuthorId} has no followers`)
                    continue
                }
                
                // Find online followers of this post's author
                const onlineFollowers = []
                console.log(`🔍 [createChessGamePost] Checking ${followerDocs.length} followers of ${postAuthorId}`)
                console.log(`🔍 [createChessGamePost] Available user IDs in socket map:`, Object.keys(userSocketMap))
                console.log(`🔍 [createChessGamePost] Socket map entries:`, Object.entries(userSocketMap).map(([id, data]) => ({ userId: id, socketId: data.socketId })))
                
                followerDocs.forEach(d => {
                    // Use same simple approach as postDeleted (which works)
                    const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                    if (userSocketMap[followerIdStr]) {
                        onlineFollowers.push(userSocketMap[followerIdStr].socketId)
                        console.log(`✅ [createChessGamePost] Found online follower of ${postAuthorId}: ${followerIdStr} (socket: ${userSocketMap[followerIdStr].socketId})`)
                    } else {
                        console.log(`⚠️ [createChessGamePost] Follower ${followerIdStr} is not online (not in socket map)`)
                    }
                })
                
                if (onlineFollowers.length > 0) {
                    // Convert Mongoose document to plain object for socket emission
                    const postObject = post.toObject ? post.toObject() : post
                    console.log(`📤 [createChessGamePost] Emitting newPost to ${onlineFollowers.length} followers of ${postAuthorId} for post: ${post._id}`)
                    console.log(`📤 [createChessGamePost] Post data:`, {
                        _id: postObject._id,
                        postedBy: postObject.postedBy,
                        text: postObject.text,
                        hasChessGameData: !!postObject.chessGameData
                    })
                    console.log(`📤 [createChessGamePost] Socket IDs to emit to:`, onlineFollowers)
                    
                    // Use same pattern as postDeleted (which works for User N)
                    // Emit to each socket individually to ensure delivery
                    onlineFollowers.forEach(socketId => {
                        io.to(socketId).emit("newPost", postObject)
                        console.log(`✅ [createChessGamePost] Emitted newPost to socket: ${socketId}`)
                    })
                    console.log(`✅ [createChessGamePost] Emitted newPost event to ${onlineFollowers.length} sockets for post: ${post._id}`)
                } else {
                    console.log(`ℹ️ [createChessGamePost] No online followers for post author ${postAuthorId}`)
                    console.log(`🔍 [createChessGamePost] All followers of ${postAuthorId}:`, followerDocs.map(d => d.followerId?.toString?.() ?? String(d.followerId)))
                    console.log(`🔍 [createChessGamePost] Online user IDs in socket map:`, Object.keys(userSocketMap))
                }
            }
        } else {
            console.error('❌ [createChessGamePost] IO instance is not available!')
        }
        
        return posts // Return posts so we can track them
    } catch (error) {
        console.error('Error creating chess game post:', error)
        throw error
    }
}

// Create card game post when two players start a game
export const createCardGamePost = async (player1Id, player2Id, roomId) => {
    try {
        // Get both players' info
        const player1 = await User.findById(player1Id).select('username name profilePic')
        const player2 = await User.findById(player2Id).select('username name profilePic')
        
        if (!player1 || !player2) {
            console.error('❌ [createCardGamePost] Player not found:', { player1Id, player2Id })
            return null
        }
        
        // Create card game data
        const cardGameData = {
            player1: {
                _id: player1._id.toString(),
                username: player1.username,
                name: player1.name,
                profilePic: player1.profilePic
            },
            player2: {
                _id: player2._id.toString(),
                username: player2.username,
                name: player2.name,
                profilePic: player2.profilePic
            },
            roomId: roomId,
            gameStatus: 'active',
            gameType: 'goFish',
            createdAt: new Date()
        }
        
        // Create posts for both players
        const posts = []
        
        // Post from player1's perspective
        const post1 = new Post({
            postedBy: player1Id,
            text: `Playing Go Fish with ${player2.name} 🃏`,
            cardGameData: JSON.stringify(cardGameData)
        })
        await post1.save()
        await post1.populate("postedBy", "username profilePic name")
        posts.push(post1)
        
        // Post from player2's perspective
        if (player1Id.toString() !== player2Id.toString()) {
            const post2 = new Post({
                postedBy: player2Id,
                text: `Playing Go Fish with ${player1.name} 🃏`,
                cardGameData: JSON.stringify(cardGameData)
            })
            await post2.save()
            await post2.populate("postedBy", "username profilePic name")
            posts.push(post2)
        }
        
        console.log('✅ [createCardGamePost] Created card game posts:', posts.map(p => p._id))
        
        // Emit newPost to online followers (same pattern as chess)
        const io = getIO()
        if (io) {
            const { getAllUserSockets } = await import('../socket/socket.js')
            const userSocketMap = await getAllUserSockets()
            
            for (const post of posts) {
                const postAuthorId = post.postedBy?._id?.toString() || post.postedBy?.toString()
                if (!postAuthorId) {
                    console.error(`❌ [createCardGamePost] Post ${post._id} has invalid postedBy field:`, post.postedBy)
                    continue
                }
                
                try {
                    const followerDocs = await Follow.find({ followeeId: postAuthorId })
                        .select('followerId')
                        .limit(10000)
                        .lean()
                    
                    if (followerDocs.length === 0) {
                        console.log(`ℹ️ [createCardGamePost] Post author ${postAuthorId} has no followers`)
                        continue
                    }
                    
                    const onlineFollowers = []
                    followerDocs.forEach(d => {
                        const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                        if (userSocketMap[followerIdStr]) {
                            onlineFollowers.push(userSocketMap[followerIdStr].socketId)
                        }
                    })
                    
                    if (onlineFollowers.length > 0) {
                        const postObject = post.toObject()
                        postObject.cardGameData = post.cardGameData
                        
                        onlineFollowers.forEach(socketId => {
                            io.to(socketId).emit("newPost", { postId: post._id, post: postObject })
                        })
                    }
                } catch (err) {
                    console.error(`❌ [createCardGamePost] Error emitting post ${post._id}:`, err)
                }
            }
        }
        
        return posts
    } catch (error) {
        console.error('Error creating card game post:', error)
        throw error
    }
}

// Function to delete card game posts by roomId
export const deleteCardGamePost = async (roomId) => {
    try {
        if (!roomId) {
            console.log('⚠️ No roomId provided for card game post deletion')
            return
        }

        // Find all posts with this roomId in cardGameData
        const posts = await Post.find({
            cardGameData: { $exists: true, $ne: null }
        })

        let deletedCount = 0
        for (const post of posts) {
            try {
                if (post.cardGameData) {
                    const cardData = JSON.parse(post.cardGameData)
                    if (cardData.roomId === roomId) {
                        // Get followers before deleting
                        const postAuthorId = post.postedBy.toString()
                        const followerDocs = await Follow.find({ followeeId: postAuthorId })
                          .select('followerId')
                          .limit(10000)
                          .lean()
                        
                        // Delete the post
                        await Post.findByIdAndDelete(post._id)
                        deletedCount++
                        console.log(`🗑️ Deleted card game post: ${post._id} for roomId: ${roomId}`)

                        // Emit post deleted to online followers
                        const io = getIO()
                        if (io && followerDocs && followerDocs.length > 0) {
                            const { getAllUserSockets } = await import('../socket/socket.js')
                            const userSocketMap = await getAllUserSockets()
                            const onlineFollowers = []
                            
                            followerDocs.forEach(d => {
                                const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                                if (userSocketMap[followerIdStr]) {
                                    onlineFollowers.push(userSocketMap[followerIdStr].socketId)
                                }
                            })
                            
                            if (onlineFollowers.length > 0) {
                                io.to(onlineFollowers).emit("postDeleted", { postId: post._id })
                            }
                        }
                    }
                }
            } catch (parseError) {
                console.error(`Error parsing cardGameData for post ${post._id}:`, parseError)
            }
        }

        if (deletedCount > 0) {
            console.log(`✅ Deleted ${deletedCount} card game post(s) for roomId: ${roomId}`)
        } else {
            console.log(`⚠️ No card game posts found for roomId: ${roomId}`)
        }
    } catch (error) {
        console.error('Error deleting card game post:', error)
        throw error
    }
}

// Function to delete chess game posts by roomId
export const deleteChessGamePost = async (roomId) => {
    try {
        if (!roomId) {
            console.log('⚠️ No roomId provided for chess post deletion')
            return
        }

        // Find all posts with this roomId in chessGameData
        const posts = await Post.find({
            chessGameData: { $exists: true, $ne: null }
        })

        let deletedCount = 0
        for (const post of posts) {
            try {
                if (post.chessGameData) {
                    const chessData = JSON.parse(post.chessGameData)
                    if (chessData.roomId === roomId) {
                        // Get followers before deleting
                        const postAuthorId = post.postedBy.toString()
                        const followerDocs = await Follow.find({ followeeId: postAuthorId })
                          .select('followerId')
                          .limit(10000)
                          .lean()
                        
                        // Delete the post
                        await Post.findByIdAndDelete(post._id)
                        deletedCount++
                        console.log(`🗑️ Deleted chess game post: ${post._id} for roomId: ${roomId}`)

                        // Emit post deleted to online followers
                        const io = getIO()
                        if (io && followerDocs && followerDocs.length > 0) {
                            const userSocketMap = await getAllUserSockets()
                            const onlineFollowers = []
                            
                            followerDocs.forEach(d => {
                                const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                                if (userSocketMap[followerIdStr]) {
                                    onlineFollowers.push(userSocketMap[followerIdStr].socketId)
                                }
                            })
                            
                            if (onlineFollowers.length > 0) {
                                io.to(onlineFollowers).emit("postDeleted", { postId: post._id })
                            }
                        }
                    }
                }
            } catch (parseError) {
                console.error(`Error parsing chessGameData for post ${post._id}:`, parseError)
            }
        }

        if (deletedCount > 0) {
            console.log(`✅ Deleted ${deletedCount} chess game post(s) for roomId: ${roomId}`)
        } else {
            console.log(`⚠️ No chess game posts found for roomId: ${roomId}`)
        }
    } catch (error) {
        console.error('Error deleting chess game post:', error)
        throw error
    }
}

// Add contributor to collaborative post
export const addContributorToPost = async (req, res) => {
    try {
        const { postId } = req.params
        const { contributorId } = req.body
        const userId = req.user._id

        const post = await Post.findById(postId)
        
        if (!post) {
            return res.status(400).json({ message: "Post not found" })
        }

        // Get post owner ID BEFORE any operations
        const postOwnerId = post.postedBy.toString()

        // Check if post is collaborative
        if (!post.isCollaborative) {
            return res.status(400).json({ message: "This post is not collaborative" })
        }

        // Check if user is already a contributor or is the original poster
        const isContributor = post.contributors.some(c => c.toString() === userId.toString())
        const isPoster = post.postedBy.toString() === userId.toString()

        if (!isContributor && !isPoster) {
            return res.status(403).json({ message: "You must be a contributor to add others" })
        }

        // Check if contributor exists
        const contributor = await User.findById(contributorId)
        if (!contributor) {
            return res.status(400).json({ message: "Contributor not found" })
        }

        // Check if already a contributor
        if (post.contributors.some(c => c.toString() === contributorId)) {
            return res.status(400).json({ message: "User is already a contributor" })
        }

        // Add contributor
        post.contributors.push(contributorId)
        await post.save()

        await post.populate("contributors", "username profilePic name")
        await post.populate("postedBy", "username profilePic name")
        
        // Log populated data to verify it's correct
        console.log('✅ [addContributorToPost] Post populated. Contributors:', post.contributors?.length)
        console.log('✅ [addContributorToPost] Contributors data:', JSON.stringify(post.contributors.map(c => ({
            id: c._id?.toString()?.substring(0, 8),
            name: c.name,
            username: c.username,
            hasProfilePic: !!c.profilePic
        })), null, 2))

        // Notify the new contributor (with real-time socket notification)
        try {
            const { createNotification } = await import('./notification.js')
            await createNotification(contributorId, 'collaboration', userId, {
                postId: post._id.toString(), // Ensure it's a string
                postText: post.text?.substring(0, 50) || 'a collaborative post'
            })
            console.log(`📬 [addContributorToPost] Created collaboration notification for user ${contributorId}`)
        } catch (err) {
            console.error('❌ [addContributorToPost] Error creating collaboration notification:', err)
        }

        // Emit real-time post update to post owner, all contributors, and followers
        const io = getIO()
        if (io) {
            const userSocketMap = await getAllUserSockets()
                            const recipients = [] // Socket IDs to receive the update
                            
                            // 1. Add post owner (always include them) - use postOwnerId we got earlier
                            const ownerSocketData = userSocketMap[postOwnerId]
            if (ownerSocketData) {
                recipients.push(ownerSocketData.socketId)
                console.log(`📤 [addContributorToPost] Adding post owner ${postOwnerId} to postUpdated recipients`)
            }
            
            // 2. Add all contributors (including the newly added one)
            if (post.contributors && post.contributors.length > 0) {
                post.contributors.forEach(contributor => {
                    const contributorId = (contributor._id || contributor).toString()
                    if (contributorId !== postOwnerId) { // Don't duplicate owner
                        const contributorSocketData = userSocketMap[contributorId]
                        if (contributorSocketData) {
                            recipients.push(contributorSocketData.socketId)
                            console.log(`📤 [addContributorToPost] Adding contributor ${contributorId} to postUpdated recipients`)
                        }
                    }
                })
            }
            
            // 3. Add followers
            const followerDocs = await Follow.find({ followeeId: post.postedBy })
              .select('followerId')
              .limit(10000)
              .lean()
            if (followerDocs && followerDocs.length > 0) {
                followerDocs.forEach(d => {
                    const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                    // Don't duplicate owner/contributors
                    if (followerIdStr !== postOwnerId && 
                        !post.contributors?.some(c => {
                            const cId = (c._id || c).toString()
                            return cId === followerIdStr
                        })) {
                        const followerSocketData = userSocketMap[followerIdStr]
                        if (followerSocketData) {
                            recipients.push(followerSocketData.socketId)
                        }
                    }
                })
            }
            
            // Emit to all recipients (owner, contributors, followers)
            const uniqueRecipients = [...new Set(recipients)] // Remove duplicates
            if (uniqueRecipients.length > 0) {
                uniqueRecipients.forEach(socketId => {
                    io.to(socketId).emit("postUpdated", { postId: post._id.toString(), post })
                })
                console.log(`📤 [addContributorToPost] Emitted postUpdated to ${uniqueRecipients.length} recipients (owner, contributors, followers)`)
            }
        }

        // Final check: Log what we're sending back
        console.log('📤 [addContributorToPost] Sending response with contributors:', post.contributors?.length)
        console.log('📤 [addContributorToPost] Response contributors data:', JSON.stringify(post.contributors.map(c => ({
            id: c._id?.toString()?.substring(0, 8) || (typeof c === 'string' ? c.substring(0, 8) : 'unknown'),
            name: c.name || 'NO NAME',
            username: c.username || 'NO USERNAME',
            type: typeof c,
            isString: typeof c === 'string'
        })), null, 2))

        res.status(200).json({
            message: "Contributor added successfully",
            post: post
        })
    } catch (error) {
        console.log(error)
        res.status(500).json(error)
    }
}

// Remove contributor from collaborative post
export const removeContributorFromPost = async(req, res) => {
    try {
        const { postId, contributorId } = req.params
        const userId = req.user._id

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({ message: "Post not found" })
        }

        // Check if post is collaborative
        if (!post.isCollaborative) {
            return res.status(400).json({ message: "This post is not collaborative" })
        }

        // Only post owner can remove contributors
        if (post.postedBy.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Only the post owner can remove contributors" })
        }

        // Cannot remove the post owner
        if (contributorId === post.postedBy.toString()) {
            return res.status(400).json({ message: "Cannot remove the post owner" })
        }

        // Check if contributor exists in the list
        const contributorIndex = post.contributors.findIndex(
            c => c.toString() === contributorId
        )
        
        if (contributorIndex === -1) {
            return res.status(400).json({ message: "Contributor not found in this post" })
        }

        // Remove contributor
        post.contributors.splice(contributorIndex, 1)
        await post.save()

        await post.populate("contributors", "username profilePic name")
        await post.populate("postedBy", "username profilePic name")

        // Emit real-time post update to post owner, all contributors, and followers
        const io = getIO()
        if (io) {
            const userSocketMap = await getAllUserSockets()
            const recipients = [] // Socket IDs to receive the update
            
            // 1. Add post owner
            const postOwnerId = post.postedBy._id?.toString() || post.postedBy.toString()
            const ownerSocketData = userSocketMap[postOwnerId]
            if (ownerSocketData) {
                recipients.push(ownerSocketData.socketId)
                console.log(`📤 [removeContributorFromPost] Adding post owner ${postOwnerId} to postUpdated recipients`)
            }
            
            // 2. Add all remaining contributors
            if (post.contributors && post.contributors.length > 0) {
                post.contributors.forEach(c => {
                    const cId = (c._id || c).toString()
                    if (cId !== postOwnerId) { // Don't duplicate owner
                        const contributorSocketData = userSocketMap[cId]
                        if (contributorSocketData) {
                            recipients.push(contributorSocketData.socketId)
                            console.log(`📤 [removeContributorFromPost] Adding contributor ${cId} to postUpdated recipients`)
                        }
                    }
                })
            }
            
            // 3. Add followers of the post owner
            const followerDocs = await Follow.find({ followeeId: postOwnerId })
              .select('followerId')
              .limit(10000)
              .lean()
            if (followerDocs && followerDocs.length > 0) {
                followerDocs.forEach(d => {
                    const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                    // Don't duplicate owner/contributors
                    if (followerIdStr !== postOwnerId && 
                        !post.contributors.some(c => (c._id || c).toString() === followerIdStr)) {
                        const followerSocketData = userSocketMap[followerIdStr]
                        if (followerSocketData) {
                            recipients.push(followerSocketData.socketId)
                        }
                    }
                })
            }
            
            // Emit to all recipients (owner, contributors, followers)
            const uniqueRecipients = [...new Set(recipients)] // Remove duplicates
            if (uniqueRecipients.length > 0) {
                const postObject = post.toObject() // Convert Mongoose document to plain object
                uniqueRecipients.forEach(socketId => {
                    io.to(socketId).emit("postUpdated", { postId: postObject._id.toString(), post: postObject })
                })
                console.log(`📤 [removeContributorFromPost] Emitted postUpdated to ${uniqueRecipients.length} recipients (owner, contributors, followers)`)
            } else {
                console.log(`⚠️ [removeContributorFromPost] No online recipients found for postUpdated event for post ${post._id}`)
            }
        }

        res.status(200).json({
            message: "Contributor removed successfully",
            post: post
        })
    } catch (error) {
        console.log(error)
        res.status(500).json(error)
    }
}

// Get all comments/replies made by a specific user
export const getUserComments = async(req,res) => {
    try {
        const { username } = req.params
        const { limit = 20, skip = 0 } = req.query
        
        // Find user by username
        const user = await User.findOne({ username })
        if (!user) {
            return res.status(404).json({ error: "User not found" })
        }
        
        const userId = user._id
        const limitNum = parseInt(limit)
        const skipNum = parseInt(skip)
        
        // Find all posts that have replies from this user
        const posts = await Post.find({
            "replies.userId": userId
        })
        .populate('postedBy', 'name username profilePic')
        .sort({ createdAt: -1 })
        .limit(1000) // Get a large batch, then filter
        
        // Extract all comments made by this user from all posts
        const allComments = []
        posts.forEach(post => {
            post.replies.forEach(reply => {
                if (reply.userId.toString() === userId.toString()) {
                    allComments.push({
                        _id: reply._id,
                        text: reply.text,
                        userId: reply.userId,
                        username: reply.username,
                        userProfilePic: reply.userProfilePic,
                        date: reply.date,
                        parentReplyId: reply.parentReplyId,
                        likes: reply.likes || [],
                        post: {
                            _id: post._id,
                            text: post.text,
                            img: post.img,
                            postedBy: post.postedBy,
                            createdAt: post.createdAt
                        }
                    })
                }
            })
        })
        
        // Sort by date (newest first)
        allComments.sort((a, b) => new Date(b.date) - new Date(a.date))
        
        // Apply pagination
        const paginatedComments = allComments.slice(skipNum, skipNum + limitNum)
        const hasMore = allComments.length > skipNum + limitNum
        
        res.status(200).json({
            comments: paginatedComments,
            total: allComments.length,
            hasMore
        })
    } catch (error) {
        console.error('Error fetching user comments:', error)
        res.status(500).json({ error: error.message })
    }
}

export const deleteComment = async(req,res) => {
    try{
        const { postId, replyId } = req.params 
        const userId = req.user._id 

        const post = await Post.findById(postId)
        
        if(!post){
            return res.status(404).json({error:"Post not found"})
        }

        const reply = post.replies.id(replyId) 
        
        if(!reply){
            return res.status(404).json({error:"Comment not found"})
        }

        // Check permissions: user must be either post owner OR comment owner
        const isPostOwner = post.postedBy.toString() === userId.toString()
        const isCommentOwner = reply.userId && reply.userId.toString() === userId.toString()

        if(!isPostOwner && !isCommentOwner){
            return res.status(403).json({error:"You can only delete your own comments or comments on your posts"})
        }

        // Helper function to recursively delete nested replies
        const deleteNestedReplies = (parentReplyId) => {
            const nestedReplies = post.replies.filter(r => 
                r.parentReplyId && r.parentReplyId.toString() === parentReplyId.toString()
            )
            
            nestedReplies.forEach(nestedReply => {
                // Recursively delete nested replies
                deleteNestedReplies(nestedReply._id)
                // Remove the nested reply
                post.replies.pull(nestedReply._id)
            })
        }

        // Delete all nested replies first
        deleteNestedReplies(replyId)

        // Delete the comment itself
        post.replies.pull(replyId)
        
        await post.save()

        res.status(200).json({
            message: "Comment deleted successfully",
            deletedReplyId: replyId
        })

    }
    catch(error){
        console.error('Error deleting comment:', error)
        res.status(500).json({error: error.message || "Failed to delete comment"})
    }
}

export const LikeComent = async(req,res) => {

    try{
      
        const { postId, replyId } = req.params 
        const userId = req.user._id 

       
        const post = await Post.findById(postId)
        
        if(!post){
            return res.status(400).json({message:"no post found"})
        }

     
        const reply = post.replies.id(replyId) 
        
        if(!reply){
            return res.status(400).json({message:"no comment found"})
        }

        // Initialize likes array if it doesn't exist (for old comments created before likes feature)
        if(!reply.likes) {
            reply.likes = []
        }
      
        // Check if user already liked this comment
        const isLiked = reply.likes.includes(userId)

        if(isLiked){
            // Unlike: remove userId from likes array
            reply.likes.pull(userId)  
        }else{
            // Like: add userId to likes array
            reply.likes.push(userId)  
            
            // Create notification for comment/reply owner when someone likes their comment or reply
            // Don't notify if user is liking their own comment/reply
            if (reply.userId && reply.userId.toString() !== userId.toString()) {
                const { createNotification } = await import('./notification.js')
                // Check if it's a reply (has parentReplyId) or a top-level comment
                const isReply = reply.parentReplyId !== null && reply.parentReplyId !== undefined
                createNotification(reply.userId, 'like', userId, {
                    postId: post._id,
                    commentText: reply.text,
                    isReply: isReply // Pass flag to distinguish reply from comment
                }).catch(err => {
                    console.error('Error creating comment/reply like notification:', err)
                })
            }
        }

   
        await post.save()

        res.status(200).json({
            message: isLiked ? "comment unliked successfully" : "comment liked successfully",
            likesCount: reply.likes.length,
            isLiked: !isLiked
        })

    }
    catch(error){
        console.log(error)
        res.status(500).json(error)
    }
}









