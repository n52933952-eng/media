
import User from '../models/user.js'
import Post from '../models/post.js'
import{v2 as cloudinary} from 'cloudinary'


export const createPost = async(req,res) => {

    try{
  
        const{postedBy,text}= req.body
         
      let {img}= req.body


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


       if(img){
        const uploadResponse = await cloudinary.uploader.upload(img)
        img = uploadResponse.secure_url
       }


       const newPost = new Post({postedBy,text,img})
       await newPost.save()
       res.status(200).json({message:"post created sufully"})

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


if(post.img){
 const imgId = post.img.split("/").pop().split(".")[0]
 await cloudinary.uploader.destroy(imgId)   
}

await Post.findByIdAndDelete(req.params.id)

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

        // Get posts from followed users
        const following = user.following 

        const feedPost = await Post.find({
            postedBy: { $in: following }
        })
        .populate("postedBy", "-password")
        .sort({createdAt:-1})
     
     return res.status(200).json(feedPost)
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

         const post = await Post.find({postedBy:user._id}).populate("postedBy","-password").sort({createdAt:-1})

         res.status(200).json(post)

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









