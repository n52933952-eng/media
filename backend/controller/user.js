import User from '../models/user.js'
import bcryptjs from 'bcryptjs' 
import GenerateToken from '../utils/GenerateToken.js'
import{v2 as cloudinary} from 'cloudinary'
import mongoose from 'mongoose'





export const SignUp = async(req,res) => {


    try{
  
        const{email,name,username,password}=req.body 

        const user = await User.findOne({$or:[{email},{username}]})

        if(user){
            return res.status(400).json({error:"user is already exist"})
        }
       
        const hashPassword = bcryptjs.hashSync(password,10)

         const newUser = await User({email,name,username,password:hashPassword})

         await newUser.save()
       
          if(newUser){
            GenerateToken(newUser._id,res)
                res.status(200).json({id:newUser._id,name:newUser.name,
                username:newUser.username,email:newUser.email,
               bio:newUser.bio,
               profilePic:newUser.profilePic,
               followers:newUser.followers,
               following:newUser.following
              })
          }else{
            res.status(400).json({error:"no user"})
          }

      }
        catch(error){
        res.status(500).json(error)
    }
}





export const LoginUser = async(req,res) => {

    try{
       
        const{username,password}= req.body

        const user = await User.findOne({username})
     
        const comaprePassword = await bcryptjs.compareSync(password,user?.password || "")

        if(!user || !comaprePassword ){
            return res.status(400).json({error:"no user found"})
        }
   
      GenerateToken(user._id,res)

      res.status(200).json({_id:user._id,username:user.username,name:user.name,email:user.email,
        bio:user.bio,
        profilePic:user.profilePic,
        followers:user.followers,
               following:user.following
      })
     

    }
    catch(error){
        console.log(error)
        res.status(500).json(error)
    }
}





export const LogOut = async(req,res) => {

    try{

   res.cookie("jwt","",{maxAge:1})
   res.status(200).json({message:"user logOut"})

    }
    catch(error){
        res.status(500).json(error)
    }
}




export const FollowAndUnfollow = async(req,res) => {

     try{
        
        const {id}= req.params 

        const userToModify = await User.findById(id)
        const currentUser = await User.findById(req.user._id)
     
        if(id === currentUser._id.toString()){
            return res.status(400).json({error:"cant folow your self"})
          }
         
            if(!userToModify || !currentUser){
            return res.status(400).json({error:"no user"})
         }

    
         const isFollowing = currentUser.following.includes(id)

         if(isFollowing){
             
           await User.findByIdAndUpdate(req.user._id,{$pull:{following:id}})
           await User.findByIdAndUpdate(id,{$pull:{followers:req.user._id}})
          
           const updatecurrent = await User.findById(req.user._id)
           const targetUser = await User.findById(id)

           res.status(200).json({action:"unfollow",current:updatecurrent,target:targetUser})

         }else{
            await User.findByIdAndUpdate(req.user._id,{$push:{following:id}})
            await User.findByIdAndUpdate(id,{$push:{followers:req.user._id}})
           
          
            const updatecurrent = await User.findById(req.user._id)
            const targetUser = await User.findById(id)

           res.status(200).json({action:"follow",current:updatecurrent,target:targetUser})
         }
          
  
    }
    catch(error){
        console.log(error)
        res.status(500).json(error)
    }
}


export const UpdateUser = async(req,res) => {

    try{
 
        const{name,email,password,bio,username}= req.body
        const userId = req.user._id 

        let user = await User.findById(userId)
        
        let {profilePic} = req.body
         
 
        if(!user){
            return res.status(400).json({error:"no user"})
        }

        if(req.params.id !== userId.toString()){
            return res.status(400).json({error:"cant update someone else profile"})
        }

      if(password && password.trim() !== ""){
        const hashPassword = await bcryptjs.hashSync(password,10)
        user.password = hashPassword
      }
       
      if(profilePic){
         
        if(user.profilePic){
          await cloudinary.uploader.destroy(user.profilePic.split("/").pop().split(".")[0])
        }
        const uploadedResponse = await cloudinary.uploader.upload(profilePic)
         profilePic = uploadedResponse.secure_url
      }

       user.name = name || user.name
       user.username = username || user.username 
       user.email = email || user.email 

        user.profilePic = profilePic || user.profilePic 
        user.bio = bio || user.bio
  
 

      user = await user.save()

      // Return safe fields only (exclude password)
      res.status(200).json({
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        bio: user.bio,
        profilePic: user.profilePic
      })
    }
    catch(error){
   
        res.status(500).json(error)
           console.log(error)
    }
}





export const getUserProfile = async(req,res) => {


    try{

        const{query}= req.params 

        let user 

        if(mongoose.Types.ObjectId.isValid(query)){
         user = await User.findOne({_id:query}).select('-password')

        }else{
          user = await User.findOne({username:query}).select('-password')
        }

      if(!user){
        return res.status(400).json({error:"no user"})
      }

      res.status(200).json(user)

    }
    catch(error){
      console.log(error)
        res.status(500).json(error)
    }
}


// NEW: Search users for mention suggestions (like @username autocomplete)
export const searchUsers = async(req, res) => {
    try {
        const { search } = req.query  // Get search term from query params (?search=john)

        if (!search || search.trim() === "") {
            return res.status(200).json([])  // Return empty array if no search term
        }

        // Search users by username (case-insensitive, matches beginning of username)
        // Returns users whose username starts with the search term
        const users = await User.find({
            username: { $regex: `^${search}`, $options: 'i' }  // ^ means starts with, 'i' means case-insensitive
        })
        .select('username name profilePic')  // Only return needed fields
        .limit(10)  // Limit to 10 suggestions

        res.status(200).json(users)
    }
    catch(error) {
        console.log(error)
        res.status(500).json(error)
    }
}







