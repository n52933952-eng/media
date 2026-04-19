
import User from '../models/user.js'
import Post from '../models/post.js'
import Follow from '../models/follow.js'
import LiveStream from '../models/liveStream.js'
import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'
import { getIO, getUserSocket, getAllUserSockets } from '../socket/socket.js'

const CLOUDINARY_UPLOAD_QUALITY = (process.env.CLOUDINARY_UPLOAD_QUALITY || 'auto:eco').trim()

/** Notify everyone listed as contributor except the poster when a collaborative post is created. */
async function notifyContributorsOnCollaborativeCreate(newPost, posterId) {
    if (!newPost?.isCollaborative || !Array.isArray(newPost.contributors)) return
    const posterStr = String(posterId)
    const others = newPost.contributors.filter((c) => {
        const cid = (c._id || c).toString()
        return cid && cid !== posterStr
    })
    if (others.length === 0) return
    const { createNotification } = await import('./notification.js')
    for (const c of others) {
        const cid = (c._id || c).toString()
        try {
            await createNotification(cid, 'collaboration', posterStr, {
                postId: newPost._id.toString(),
                postText: (newPost.text || '').substring(0, 50) || 'a collaborative post'
            })
        } catch (e) {
            console.error('❌ [notifyContributorsOnCollaborativeCreate]', cid, e)
        }
    }
}

export const createPost = async(req,res) => {

    try{
  
        const{postedBy,text,isCollaborative,contributors}= req.body
        // Multipart/form-data sends contributors as a JSON string (same as web); JSON body sends an array.
        let contributorsParsed = contributors
        if (typeof contributors === 'string') {
            try {
                const parsed = JSON.parse(contributors)
                if (Array.isArray(parsed)) contributorsParsed = parsed
            } catch {
                contributorsParsed = undefined
            }
        }
        // Multipart sends strings; only treat explicit true / "true" as collaborative (string "false" is truthy in JS)
        const wantCollaborative = isCollaborative === true || isCollaborative === 'true'
         
      let img = ''

        const textTrim = text != null ? String(text).trim() : ''

        if(!postedBy){
            return res.status(400).json({error:"postedBy is required"})
        }

        if(!textTrim && !req.file){
            return res.status(400).json({error:"text or media is required"})
        }

      const user = await User.findById(postedBy)

       if(!user){
        return res.status(400).json({error:"now user"})
       } 

       if(user._id.toString() !== req.user._id.toString()){
        return res.status(400).json({error:"unthorized"})
       }

       const MaxLength = 500 

       if(textTrim.length > MaxLength){
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
              ...(req.file.mimetype.startsWith('video/')
                ? {
                    // Upload-side optimization so feed playback starts faster on mobile networks.
                    transformation: [
                      {
                        width: 1080,
                        crop: 'limit',
                        quality: CLOUDINARY_UPLOAD_QUALITY,
                        fetch_format: 'mp4',
                        video_codec: 'auto',
                        audio_codec: 'aac',
                      },
                    ],
                  }
                : {}),
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
                 const postData = {postedBy,text:textTrim,img}
                 if (wantCollaborative) {
                   postData.isCollaborative = true
                   postData.contributors = contributorsParsed && Array.isArray(contributorsParsed) ? contributorsParsed : [postedBy]
                 }
                 const newPost = new Post(postData)
                 await newPost.save()
                 
                 // Populate postedBy for socket emission
                 await newPost.populate("postedBy", "username profilePic name")
                 
                 await notifyContributorsOnCollaborativeCreate(newPost, postedBy)

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
                   metadata: { text: (textTrim || '').substring(0, 50), hasImage: !!img }
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
       const postData = {postedBy,text:textTrim,img}
       if (wantCollaborative) {
         postData.isCollaborative = true
         postData.contributors = contributorsParsed && Array.isArray(contributorsParsed) ? contributorsParsed : [postedBy]
       }
       const newPost = new Post(postData)
       await newPost.save()
       
       // Populate postedBy for socket emission
       await newPost.populate("postedBy", "username profilePic name")
       
       await notifyContributorsOnCollaborativeCreate(newPost, postedBy)

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
        
        // Check if user is a contributor (for collaborative posts) — works populated or raw ObjectIds
        const isContributor =
            post.isCollaborative &&
            Array.isArray(post.contributors) &&
            post.contributors.some((c) => {
                const cid = c && c._id != null ? c._id.toString() : String(c)
                return cid === userId.toString()
            })
        
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
                        ...(req.file.mimetype.startsWith('video/')
                            ? {
                                // Keep the same optimization path on edit/replace media.
                                transformation: [
                                    {
                                        width: 1080,
                                        crop: 'limit',
                                        quality: CLOUDINARY_UPLOAD_QUALITY,
                                        fetch_format: 'mp4',
                                        video_codec: 'auto',
                                        audio_codec: 'aac',
                                    },
                                ],
                              }
                            : {}),
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
                        post.text = text !== undefined && text !== null ? text : post.text
                        post.img = img
                        post.editedAt = new Date()
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
        post.text = text !== undefined && text !== null ? text : post.text
        post.editedAt = new Date()
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
     const rawMid = req.body?.footballMatchId
     const mid =
         rawMid != null && String(rawMid).trim() !== ''
             ? String(rawMid).trim().slice(0, 128)
             : null
  
     const post = await Post.findById(id)
     
     if(!post){
        return res.status(400).json({message:"no post found"})
     }

     /** Per–match-card like (Football live list): does not toggle post.likes. */
     if (mid) {
         if (!Array.isArray(post.footballMatchLikes)) post.footballMatchLikes = []
         let entry = post.footballMatchLikes.find((e) => String(e.footballMatchId) === mid)
         if (!entry) {
             post.footballMatchLikes.push({ footballMatchId: mid, likes: [] })
             entry = post.footballMatchLikes[post.footballMatchLikes.length - 1]
         }
         const likesArr = Array.isArray(entry.likes) ? entry.likes : []
         const uidStr = userId.toString()
         const idx = likesArr.findIndex((l) => (l && l.toString ? l.toString() : String(l)) === uidStr)
         let isLikedAfter = false
         if (idx >= 0) {
             entry.likes.splice(idx, 1)
             isLikedAfter = false
         } else {
             entry.likes.push(userId)
             isLikedAfter = true
             if (post.postedBy.toString() !== uidStr) {
                 const { createNotification } = await import('./notification.js')
                 createNotification(post.postedBy, 'like', userId, {
                     postId: post._id,
                     footballMatchId: mid,
                 }).catch((err) => {
                     console.error('Error creating match-like notification:', err)
                 })
             }
             const { createActivity } = await import('./activity.js')
             createActivity(userId, 'like', {
                 postId: post._id,
                 targetUser: post.postedBy,
                 metadata: { postText: (post.text || '').substring(0, 50) || '', footballMatchId: mid },
             }).catch((err) => {
                 console.error('Error creating activity:', err)
             })
         }
         await post.save()
         const likesCount = Array.isArray(entry.likes) ? entry.likes.length : 0
         return res.status(200).json({
             scope: 'footballMatch',
             footballMatchId: mid,
             isLiked: isLikedAfter,
             likesCount,
             footballMatchLikes: post.footballMatchLikes,
         })
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
  
        const { text, footballMatchId: footballMatchIdRaw } = req.body
        const username = req.user.username
        const userId = req.user._id 
        const id = req.params.id 
        const userProfilePic = req.user.profilePic 

        const post = await Post.findById(id)

        if(!post){
            return res.status(400).json({message:"no post"})
        }

        let footballMatchId = null
        if (footballMatchIdRaw != null && String(footballMatchIdRaw).trim() !== '') {
            footballMatchId = String(footballMatchIdRaw).trim().slice(0, 128)
        }
     
        const reply = {
            text,
            username,
            userId,
            userProfilePic,
            likes: [],  // Initialize likes array
            ...(footballMatchId ? { footballMatchId } : {}),
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
        
        // Do NOT return empty when following.length === 0 — users can still have
        // channel posts (channelAddedBy) and may follow Football/Weather via Follow later.
        // Previously this caused "Fetched 0 posts" after adding a channel with no other follows.
        
        // Pagination parameters
        const limit = parseInt(req.query.limit) || 10 // Default to 10 posts per page
        const skip = parseInt(req.query.skip) || 0 // Skip for pagination
        
        // Get Football account and check if user follows it
        const footballAccount = await User.findOne({ username: 'Football' }).select('_id')
        // Check if user follows Football - convert all to strings for reliable comparison
        const followsFootball = footballAccount && following.some(followId => {
            return followId.toString() === footballAccount._id.toString()
        })
        // If user follows Football, capture *follow time* so Football post can sort as "just added"
        // without mutating the Football post document for all users.
        let footballFollowedAtMs = 0
        if (followsFootball && footballAccount) {
            try {
                const footballFollowDoc = await Follow.findOne({ followerId: userId, followeeId: footballAccount._id })
                    .select('createdAt')
                    .lean()
                if (footballFollowDoc?.createdAt) {
                    footballFollowedAtMs = new Date(footballFollowDoc.createdAt).getTime()
                }
            } catch (_) {
                footballFollowedAtMs = 0
            }
        }

        // Get Weather account and check if user follows it
        const weatherAccount = await User.findOne({ username: 'Weather' }).select('_id')
        const followsWeather = weatherAccount && following.some(followId => {
            return followId.toString() === weatherAccount._id.toString()
        })
        let weatherFollowedAtMs = 0
        if (followsWeather && weatherAccount) {
            try {
                const weatherFollowDoc = await Follow.findOne({ followerId: userId, followeeId: weatherAccount._id })
                    .select('createdAt')
                    .lean()
                if (weatherFollowDoc?.createdAt) {
                    weatherFollowedAtMs = new Date(weatherFollowDoc.createdAt).getTime()
                }
            } catch (_) {
                weatherFollowedAtMs = 0
            }
        }
        
        // Strategy: Always include Football and channel posts in first page, sorted with normal posts
        // For first page (skip=0): Get normal posts + always include Football + channels
        // For subsequent pages: Get normal posts only (Football and channels already shown on page 1)
        
        // SCALABLE: Single $in query replaces N per-user queries
        const followedUserIds = following.filter(id => id.toString() !== userId.toString())

        // Exclude system accounts (Football/Weather) from the normal feed query — fetched separately below
        const systemAccountIds = [
            footballAccount?._id?.toString(),
            weatherAccount?._id?.toString()
        ].filter(Boolean)
        const normalFollowedIds = followedUserIds.filter(id => !systemAccountIds.includes(id.toString()))

        // ONE query instead of N queries, then cap to 3 posts per user in JS
        let normalPostsPromise = Promise.resolve([])
        if (normalFollowedIds.length > 0) {
            normalPostsPromise = Post.find({
                $or: [
                    { postedBy: { $in: normalFollowedIds } },
                    { isCollaborative: true, contributors: { $in: normalFollowedIds } }
                ]
            })
                .populate("postedBy", "-password")
                .populate("contributors", "username profilePic name")
                .sort({ updatedAt: -1, createdAt: -1 })
                .limit(normalFollowedIds.length * 3 + 50) // safety cap: 3 per user + buffer
                .lean()
        }

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

        // Get Weather post if user follows Weather (latest 1)
        let weatherPostsPromise = Promise.resolve([])
        if (followsWeather && weatherAccount) {
            weatherPostsPromise = Post.find({
                postedBy: weatherAccount._id,
                weatherData: { $exists: true, $ne: null },
            })
                .populate("postedBy", "-password")
                .populate("contributors", "username profilePic name")
                .sort({ updatedAt: -1, createdAt: -1 })
                .limit(1)
        }
        
        // Collaborative posts where the current user is a contributor (even if they don't follow the author)
        const contributorPostsPromise = Post.find({
            isCollaborative: true,
            contributors: userId
        })
            .populate("postedBy", "-password")
            .populate("contributors", "username profilePic name")
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(40)

        // Wait for all posts to be fetched
        const [normalPosts, channelPosts, footballPosts, weatherPosts, contributorPosts] = await Promise.all([
            normalPostsPromise,
            channelPostsPromise,
            footballPostsPromise,
            weatherPostsPromise,
            contributorPostsPromise
        ])
        
        // SIMPLE APPROACH: 
        // 1. Get 3 newest posts from each followed user
        // 2. Combine with Football and channel posts
        // 3. Sort ALL together by createdAt (newest first)
        // 4. First page: Football + Channels + 12 normal posts (all sorted together)
        // 5. Subsequent pages: Only normal posts
        
        // Cap to 3 newest posts per user (in JS, after single DB query)
        const perUserMap = new Map()
        for (const post of normalPosts) {
            const pb = post.postedBy
            const uid = pb && pb._id != null ? pb._id.toString() : String(pb)
            if (!perUserMap.has(uid)) perUserMap.set(uid, [])
            if (perUserMap.get(uid).length < 3) perUserMap.get(uid).push(post)
        }
        const cappedNormalPosts = [...perUserMap.values()].flat()

        // Merge capped normal posts + collaborative contributor posts, remove duplicates
        let allNormalPosts = [...cappedNormalPosts, ...contributorPosts]
        
        // Sort by last activity
        allNormalPosts.sort((a, b) => {
            const dateA = new Date(a.updatedAt || a.createdAt).getTime()
            const dateB = new Date(b.updatedAt || b.createdAt).getTime()
            return dateB - dateA
        })
        
        // Remove duplicates
        const uniqueNormalPosts = []
        const seenPostIds = new Set()
        for (const post of allNormalPosts) {
            const postId = post._id.toString()
            if (!seenPostIds.has(postId)) {
                uniqueNormalPosts.push(post)
                seenPostIds.add(postId)
            }
        }

        // Hide own solo posts from feed (show only if collaborative with another contributor)
        const viewerIdStr = userId.toString()
        const hasAnotherContributor = (post, authorIdStr) => {
            if (!post.isCollaborative || !Array.isArray(post.contributors)) return false
            return post.contributors.some((c) => {
                const cid = c && c._id != null ? c._id.toString() : String(c)
                return cid && cid !== authorIdStr
            })
        }
        const feedNormalPosts = uniqueNormalPosts.filter((post) => {
            const pb = post.postedBy
            if (!pb) return false
            const aid = pb._id != null ? pb._id.toString() : String(pb)
            if (aid !== viewerIdStr) return true
            return hasAnotherContributor(post, viewerIdStr)
        })

        // Build pinned posts (Football + Weather + Channels) — always sent on every page
        // Mobile deduplication handles not showing them twice
        const pinnedPosts = []
        if (footballPosts.length > 0) {
            const fp = footballPosts[0]
            try { if (footballFollowedAtMs) fp.__viewerSortBoostMs = footballFollowedAtMs } catch (_) {}
            pinnedPosts.push(fp)
        }
        if (weatherPosts.length > 0) {
            const wp = weatherPosts[0]
            try { if (weatherFollowedAtMs) wp.__viewerSortBoostMs = weatherFollowedAtMs } catch (_) {}
            pinnedPosts.push(wp)
        }
        pinnedPosts.push(...channelPosts)

        // Page 1: live streams + pinned + first 12 normal posts
        if (skip === 0) {
            // Fetch active live streams from followed users (+ own)
            const liveFollowIds = [...following.map(String), String(userId)]
            const activeStreams = await LiveStream.find({
                streamer: { $in: liveFollowIds },
                active: true,
            })
            .populate('streamer', 'name username profilePic')
            .sort({ startedAt: -1 })
            .lean()

            // Shape live streams as pseudo-posts so the frontend renders them uniformly
            const livePseudoPosts = activeStreams.map(s => ({
                _id:      `live_${s._id}`,
                isLive:   true,
                liveStreamId: String(s._id),
                roomName: s.roomName,
                postedBy: s.streamer,
                createdAt: s.startedAt,
                updatedAt: s.startedAt,
            }))

            const topNormalPosts = feedNormalPosts.slice(0, 12)
            // Pinned (Football / Weather / channels) must not compete with normal posts — otherwise
            // Football can sink below fresher normals when multiple lives prepend. Sort each group only.
            const feedSortKey = (a) => {
                const boost = a && typeof a.__viewerSortBoostMs === 'number' ? a.__viewerSortBoostMs : 0
                return Math.max(new Date(a.updatedAt || a.createdAt).getTime(), boost)
            }
            const pinnedSorted = [...pinnedPosts].sort((a, b) => feedSortKey(b) - feedSortKey(a))
            const normalsSorted = [...topNormalPosts].sort((a, b) => feedSortKey(b) - feedSortKey(a))
            const combinedPosts = [...livePseudoPosts, ...pinnedSorted, ...normalsSorted]
            
            const hasMore = feedNormalPosts.length > 12
            
            return res.status(200).json({ 
                posts: combinedPosts,
                hasMore,
                totalCount: feedNormalPosts.length,
                liveStreams: livePseudoPosts,
            })
        }
        
        // Subsequent pages: normal posts only (Football/Weather/Channels already on page 1, stay in place)
        const startIndex = skip
        const endIndex = startIndex + limit
        const paginatedNormal = feedNormalPosts.slice(startIndex, endIndex)
        const hasMore = endIndex < feedNormalPosts.length
        const totalCount = feedNormalPosts.length
        
        console.log(`📄 [getFeedPost] Page ${Math.floor(skip / limit) + 1}: Returning ${paginatedNormal.length} posts (skip: ${skip}, hasMore: ${hasMore})`)
        
        return res.status(200).json({ 
            posts: paginatedNormal,
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
        /** Inherit match scope from the root of the thread (for Football per-match comments). */
        let inheritedFootballMatchId = null
        if (parentReplyId) {
            // Find the parent comment/reply that's being replied to
            let threadReply = post.replies.id(parentReplyId)
            if (threadReply) {
                // The person being replied to is automatically mentioned
                mentionedUser = {
                    userId: threadReply.userId,
                    username: threadReply.username
                }
                let root = threadReply
                let guard = 0
                while (root && root.parentReplyId && guard < 50) {
                    const pr = post.replies.id(root.parentReplyId)
                    if (!pr) break
                    root = pr
                    guard++
                }
                if (root?.footballMatchId) {
                    inheritedFootballMatchId = String(root.footballMatchId).slice(0, 128)
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
            likes: [],  // Initialize likes array
            ...(inheritedFootballMatchId ? { footballMatchId: inheritedFootballMatchId } : {}),
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
        
        const p1Str = player1Id?.toString?.() ?? String(player1Id)
        const p2Str = player2Id?.toString?.() ?? String(player2Id)

        if (io) {
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

                // Per-user Redis lookup (avoids stale bulk SCAN + always include both co-players)
                const targetSocketIds = new Set()
                console.log(`🔍 [createChessGamePost] Checking ${followerDocs.length} followers of ${postAuthorId} (getUserSocket each)`)

                for (const d of followerDocs) {
                    const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                    try {
                        const sock = await getUserSocket(followerIdStr)
                        if (sock?.socketId) {
                            targetSocketIds.add(sock.socketId)
                            console.log(`✅ [createChessGamePost] Online follower of ${postAuthorId}: ${followerIdStr} (${sock.socketId})`)
                        } else {
                            console.log(`⚠️ [createChessGamePost] Follower ${followerIdStr} has no socket (offline / reconnect)`)
                        }
                    } catch (e) {
                        console.warn(`⚠️ [createChessGamePost] getUserSocket failed for follower ${followerIdStr}:`, e?.message)
                    }
                }

                for (const pid of [p1Str, p2Str]) {
                    if (!pid || pid === 'undefined') continue
                    try {
                        const sock = await getUserSocket(pid)
                        if (sock?.socketId) targetSocketIds.add(sock.socketId)
                    } catch (_) {
                        /* ignore */
                    }
                }

                if (targetSocketIds.size > 0) {
                    const postObject = post.toObject ? post.toObject() : post
                    console.log(`📤 [createChessGamePost] Emitting newPost to ${targetSocketIds.size} socket(s) for author ${postAuthorId}, post: ${post._id}`)
                    console.log(`📤 [createChessGamePost] Post data:`, {
                        _id: postObject._id,
                        postedBy: postObject.postedBy,
                        text: postObject.text,
                        hasChessGameData: !!postObject.chessGameData,
                    })
                    for (const socketId of targetSocketIds) {
                        io.to(socketId).emit('newPost', postObject)
                        console.log(`✅ [createChessGamePost] Emitted newPost to socket: ${socketId}`)
                    }
                    console.log(`✅ [createChessGamePost] Done post ${post._id}`)
                } else {
                    console.log(`ℹ️ [createChessGamePost] No sockets for post author ${postAuthorId} (followers + players offline?)`)
                    console.log(`🔍 [createChessGamePost] All followers:`, followerDocs.map(d => d.followerId?.toString?.() ?? String(d.followerId)))
                    if (roomId && typeof roomId === 'string' && roomId.startsWith('chess_')) {
                        const postObject = post.toObject ? post.toObject() : post
                        io.to(roomId).emit('newPost', postObject)
                        console.log(`📤 [createChessGamePost] Fallback: newPost only to room ${roomId}`)
                    }
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

        const cardP1 = player1Id?.toString?.() ?? String(player1Id)
        const cardP2 = player2Id?.toString?.() ?? String(player2Id)

        // Emit newPost to online followers + both players (per-user socket lookup, same as chess)
        const io = getIO()
        if (io) {
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

                    const targetSocketIds = new Set()
                    for (const d of followerDocs) {
                        const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                        try {
                            const sock = await getUserSocket(followerIdStr)
                            if (sock?.socketId) targetSocketIds.add(sock.socketId)
                        } catch (_) {
                            /* ignore */
                        }
                    }
                    for (const pid of [cardP1, cardP2]) {
                        if (!pid || pid === 'undefined') continue
                        try {
                            const sock = await getUserSocket(pid)
                            if (sock?.socketId) targetSocketIds.add(sock.socketId)
                        } catch (_) {
                            /* ignore */
                        }
                    }

                    const postObject = post.toObject()
                    postObject.cardGameData = post.cardGameData
                    const wrapped = { postId: post._id, post: postObject }

                    if (targetSocketIds.size > 0) {
                        for (const socketId of targetSocketIds) {
                            io.to(socketId).emit('newPost', wrapped)
                        }
                    } else if (roomId && typeof roomId === 'string' && roomId.startsWith('card_')) {
                        io.to(roomId).emit('newPost', wrapped)
                        console.log(`📤 [createCardGamePost] Fallback newPost to room ${roomId}`)
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

        // Extract player IDs from roomId (format: card_player1Id_player2Id_timestamp)
        let player1Id = null
        let player2Id = null
        if (roomId && roomId.startsWith('card_')) {
            const roomIdParts = roomId.split('_')
            if (roomIdParts.length >= 3) {
                player1Id = roomIdParts[1]
                player2Id = roomIdParts[2]
            }
        }

        // Find all posts with this roomId in cardGameData
        const posts = await Post.find({
            $or: [
                { cardGameData: { $exists: true, $ne: null } },
                // Fallback: also search by text pattern if cardGameData is missing
                ...(player1Id && player2Id ? [
                    { text: { $regex: /Playing Go Fish with.*🃏/i }, postedBy: { $in: [player1Id, player2Id] } }
                ] : [])
            ]
        })

        let deletedCount = 0
        for (const post of posts) {
            try {
                let shouldDelete = false
                
                // Method 1: Check cardGameData
                if (post.cardGameData) {
                    const cardData = JSON.parse(post.cardGameData)
                    if (cardData.roomId === roomId) {
                        shouldDelete = true
                    }
                }
                
                // Method 2: Fallback - match by text pattern and players
                if (!shouldDelete && player1Id && player2Id) {
                    const postAuthorId = post.postedBy?.toString?.() ?? String(post.postedBy)
                    if ((postAuthorId === player1Id || postAuthorId === player2Id) &&
                        post.text && post.text.includes('Playing Go Fish with') && post.text.includes('🃏')) {
                        // Additional check: make sure this post is recent (within last hour)
                        const postDate = new Date(post.createdAt || post.updatedAt)
                        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
                        if (postDate > oneHourAgo) {
                            shouldDelete = true
                            console.log(`🔄 [deleteCardGamePost] Using fallback method to delete post: ${post._id}`)
                        }
                    }
                }
                
                if (shouldDelete) {
                    // Get followers before deleting
                    const postAuthorId = post.postedBy?.toString?.() ?? String(post.postedBy)
                    const followerDocs = await Follow.find({ followeeId: postAuthorId })
                      .select('followerId')
                      .limit(10000)
                      .lean()
                    
                    // Get cardData for player info (if available)
                    let cardData = null
                    if (post.cardGameData) {
                        try {
                            cardData = JSON.parse(post.cardGameData)
                        } catch (e) {
                            console.error(`Error parsing cardGameData for post ${post._id}:`, e)
                        }
                    }
                    
                    // Store post ID before deleting
                    const deletedPostId = post._id.toString()
                    
                    // Delete the post
                    await Post.findByIdAndDelete(post._id)
                    deletedCount++
                    console.log(`🗑️ Deleted card game post: ${deletedPostId} for roomId: ${roomId}`)

                    // Emit post deleted to post author, other player, and all followers
                    const io = getIO()
                    if (io) {
                        try {
                            io.emit('postDeleted', { postId: deletedPostId })
                        } catch (emitErr) {
                            console.warn('⚠️ [deleteCardGamePost] Global postDeleted emit failed:', emitErr?.message)
                        }
                        const userSocketMap = await getAllUserSockets()
                        const recipients = new Set() // Use Set to avoid duplicates
                        
                        // Add post author (player who created this post)
                        const postAuthorSocket = userSocketMap[postAuthorId]
                        if (postAuthorSocket) {
                            recipients.add(postAuthorSocket.socketId)
                            console.log(`✅ [deleteCardGamePost] Added post author ${postAuthorId} to recipients (socket: ${postAuthorSocket.socketId})`)
                        } else {
                            console.log(`⚠️ [deleteCardGamePost] Post author ${postAuthorId} not found in socket map`)
                        }
                        
                        // Add other player (if different from post author)
                        let otherPlayerId = null
                        if (cardData) {
                            otherPlayerId = cardData.player1?._id === postAuthorId 
                                ? cardData.player2?._id 
                                : cardData.player1?._id
                        } else if (player1Id && player2Id) {
                            // Fallback: use extracted IDs from roomId
                            otherPlayerId = postAuthorId === player1Id ? player2Id : player1Id
                        }
                        
                        if (otherPlayerId) {
                            const otherPlayerSocket = userSocketMap[otherPlayerId]
                            if (otherPlayerSocket) {
                                recipients.add(otherPlayerSocket.socketId)
                                console.log(`✅ [deleteCardGamePost] Added other player ${otherPlayerId} to recipients (socket: ${otherPlayerSocket.socketId})`)
                            } else {
                                console.log(`⚠️ [deleteCardGamePost] Other player ${otherPlayerId} not found in socket map`)
                            }
                        }
                        
                        // Add all followers
                        if (followerDocs && followerDocs.length > 0) {
                            followerDocs.forEach(d => {
                                const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                                if (userSocketMap[followerIdStr]) {
                                    recipients.add(userSocketMap[followerIdStr].socketId)
                                }
                            })
                        }
                        
                        // Emit to all recipients
                        if (recipients.size > 0) {
                            recipients.forEach(socketId => {
                                io.to(socketId).emit("postDeleted", { postId: deletedPostId })
                                console.log(`📤 [deleteCardGamePost] Emitted postDeleted for post ${deletedPostId} to socket: ${socketId}`)
                            })
                            console.log(`📤 [deleteCardGamePost] Emitted postDeleted to ${recipients.size} recipients (author, other player, and followers) for post: ${deletedPostId}`)
                        } else {
                            console.log(`⚠️ [deleteCardGamePost] No recipients found for post ${deletedPostId}`)
                        }
                    } else {
                        console.log(`⚠️ [deleteCardGamePost] IO instance not available`)
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
                        const deletedPostId = post._id.toString()
                        await Post.findByIdAndDelete(post._id)
                        deletedCount++
                        console.log(`🗑️ Deleted chess game post: ${post._id} for roomId: ${roomId}`)

                        // Emit post deleted to post author, other player, and all followers
                        const io = getIO()
                        if (io) {
                            // Broadcast so every connected client drops the post (fixes stale "Live" on Feed)
                            try {
                                io.emit('postDeleted', { postId: deletedPostId })
                            } catch (emitErr) {
                                console.warn('⚠️ [deleteChessGamePost] Global postDeleted emit failed:', emitErr?.message)
                            }
                            const userSocketMap = await getAllUserSockets()
                            const recipients = new Set() // Use Set to avoid duplicates
                            
                            // Add post author (player who created this post)
                            if (userSocketMap[postAuthorId]) {
                                recipients.add(userSocketMap[postAuthorId].socketId)
                            }
                            
                            // Add other player (if different from post author)
                            const otherPlayerId = chessData.player1?._id === postAuthorId 
                                ? chessData.player2?._id 
                                : chessData.player1?._id
                            if (otherPlayerId && userSocketMap[otherPlayerId]) {
                                recipients.add(userSocketMap[otherPlayerId].socketId)
                            }
                            
                            // Add all followers
                            if (followerDocs && followerDocs.length > 0) {
                                followerDocs.forEach(d => {
                                    const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                                    if (userSocketMap[followerIdStr]) {
                                        recipients.add(userSocketMap[followerIdStr].socketId)
                                    }
                                })
                            }
                            
                            // Emit to all recipients
                            if (recipients.size > 0) {
                                recipients.forEach(socketId => {
                                    io.to(socketId).emit("postDeleted", { postId: post._id })
                                })
                                console.log(`📤 Emitted postDeleted to ${recipients.size} recipients (author, other player, and followers) for post: ${post._id}`)
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

        // Add contributor (bump updatedAt so feeds / sorting show fresh activity for followers)
        post.contributors.push(contributorId)
        post.updatedAt = new Date()
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

        // Permissions:
        // - Post owner can remove any contributor (except themselves)
        // - A contributor can remove themselves (leave the collaborative post)
        const isOwner = post.postedBy.toString() === userId.toString()
        if (!isOwner && contributorId !== userId.toString()) {
            return res.status(403).json({ message: "You can only remove yourself from this post" })
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
        // Bump updatedAt so followers see recency (and web "Edited" label reflects membership change)
        post.updatedAt = new Date()
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









