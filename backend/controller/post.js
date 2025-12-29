
import User from '../models/user.js'
import Post from '../models/post.js'
import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'
import { getIO } from '../socket/socket.js'


export const createPost = async(req,res) => {

    try{
  
        const{postedBy,text}= req.body
         
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
                 const newPost = new Post({postedBy,text,img})
                 await newPost.save()
                 
                 // Populate postedBy for socket emission
                 await newPost.populate("postedBy", "username profilePic name")
                 
                 // Emit new post to all followers via Socket.IO
                 const io = getIO()
                 if (io) {
                   io.emit("newPost", newPost)
                   console.log('📤 Emitted newPost via socket:', newPost._id)
                 }
                 
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
       const newPost = new Post({postedBy,text,img})
       await newPost.save()
       
       // Populate postedBy for socket emission
       await newPost.populate("postedBy", "username profilePic name")
       
       // Emit new post to all followers via Socket.IO
       const io = getIO()
       if (io) {
         io.emit("newPost", newPost)
         console.log('📤 Emitted newPost via socket:', newPost._id)
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

        if(!post){
            return res.status(500).json({message:"no post"})
        }
  
      res.status(200).json(post)

    }
    catch(error){
        res.status(500).json(error)
    }


}





export const deletePost = async(req,res) => {
    try{
      const post = await Post.findById(req.params.id)

      if(!post){
        return res.status(400).json({message:"no post"})
      }

      if(post.postedBy.toString() !== req.user._id.toString()){
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

      // Delete the post from MongoDB
      await Post.findByIdAndDelete(req.params.id)

      // Emit post deleted event via Socket.IO
      const io = getIO()
      if (io) {
        io.emit("postDeleted", { postId: req.params.id })
        console.log('🗑️ Emitted postDeleted via socket:', req.params.id)
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
        const user = await User.findById(userId)

        if(!user){
            return res.status(400).json({error:"no user"})
        }

        // Get posts from followed users with pagination
        const following = user.following 
        
        // Pagination parameters
        const limit = parseInt(req.query.limit) || 10 // Default to 10 posts per page
        const skip = parseInt(req.query.skip) || 0 // Skip for pagination
        
        // Build query
        const query = {
            postedBy: { $in: following }
        }

        const feedPost = await Post.find(query)
        .populate("postedBy", "-password")
        .sort({createdAt:-1})
        .limit(limit)
        .skip(skip)
        
        // Check if there are more posts
        const totalCount = await Post.countDocuments(query)
        const hasMore = (skip + limit) < totalCount
     
     return res.status(200).json({ 
         posts: feedPost,
         hasMore,
         totalCount
     })
    }
    catch(error){
 
        res.status(500).json(error)
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
        
        res.status(200).json(newReply)
    }
    catch(error) {
        console.log(error)
        res.status(500).json(error)
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









