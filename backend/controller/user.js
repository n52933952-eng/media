import User from '../models/user.js'
import Post from '../models/post.js'
import bcryptjs from 'bcryptjs' 
import GenerateToken from '../utils/GenerateToken.js'
import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'





export const SignUp = async(req,res) => {


    try{
  
        const{email,name,username,password,country}=req.body 

        const user = await User.findOne({$or:[{email},{username}]})

        if(user){
            return res.status(400).json({error:"user is already exist"})
        }
       
        const hashPassword = bcryptjs.hashSync(password,10)

         const newUser = await User({email,name,username,password:hashPassword,country:country || ""})
         
         console.log(`📝 Creating new user: ${username}, country: "${country || 'NOT SET'}"`)

         await newUser.save()
       
          if(newUser){
            GenerateToken(newUser._id,res)
                res.status(200).json({id:newUser._id,name:newUser.name,
                username:newUser.username,email:newUser.email,
               bio:newUser.bio,
               profilePic:newUser.profilePic,
               country:newUser.country,
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
        country:user.country,
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
          
           // Delete follow notification when user unfollows
           const { deleteFollowNotification } = await import('./notification.js')
           deleteFollowNotification(id, req.user._id).catch(err => {
               console.error('Error deleting follow notification:', err)
           })
          
           // If unfollowing Football account, emit postDeleted events for all Football posts
           // This ensures the posts are removed from the user's feed immediately
           if (userToModify.username === 'Football') {
               try {
                   const Post = (await import('../models/post.js')).default
                   const { getIO, getUserSocketMap } = await import('../socket/socket.js')
                   
                   const footballPosts = await Post.find({
                       postedBy: id,
                       footballData: { $exists: true, $ne: null }
                   }).select('_id')
                   
                   if (footballPosts.length > 0) {
                       const io = getIO()
                       if (io) {
                           const userSocketMap = getUserSocketMap()
                           const userSocketData = userSocketMap[req.user._id.toString()]
                           
                           if (userSocketData && userSocketData.socketId) {
                               // Emit postDeleted for each Football post
                               footballPosts.forEach(post => {
                                   io.to(userSocketData.socketId).emit('postDeleted', { postId: post._id.toString() })
                               })
                               console.log(`🗑️ [FollowAndUnfollow] Emitted postDeleted for ${footballPosts.length} Football post(s) to user ${req.user.username}`)
                           }
                       }
                   }
               } catch (error) {
                   console.error('❌ [FollowAndUnfollow] Error emitting postDeleted events:', error)
               }
           }
          
           const updatecurrent = await User.findById(req.user._id)
           const targetUser = await User.findById(id)

           res.status(200).json({action:"unfollow",current:updatecurrent,target:targetUser})

         }else{
            await User.findByIdAndUpdate(req.user._id,{$push:{following:id}})
            await User.findByIdAndUpdate(id,{$push:{followers:req.user._id}})
           
            // Note: Football posts are global and remain in database.
            // Feed already filters by following list, so user will see Football posts in feed.
            // Frontend triggers post creation when following Football (in SuggestedChannels.jsx)
          
            const updatecurrent = await User.findById(req.user._id)
            const targetUser = await User.findById(id)

            // Create notification for the user being followed
            const { createNotification } = await import('./notification.js')
            createNotification(id, 'follow', req.user._id).catch(err => {
                console.error('Error creating follow notification:', err)
            })
            
            // Create activity for activity feed
            const { createActivity } = await import('./activity.js')
            createActivity(req.user._id, 'follow', {
                targetUser: id
            }).catch(err => {
                console.error('Error creating activity:', err)
            })

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
 
        const{name,email,password,bio,username,country}= req.body
        const userId = req.user._id 

        let user = await User.findById(userId)
        
        let profilePic = req.body.profilePic
         

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
       
      // Handle file upload via Multer to Cloudinary
      if(req.file) {
        return new Promise((resolve, reject) => {
          
          const stream = cloudinary.uploader.upload_stream(
            {
              resource_type: 'image',
              folder: 'profile-pics',
            },
            async (error, result) => {
              if (error) {
                console.error('Cloudinary upload error:', error)
                if (!res.headersSent) {
                  res.status(500).json({ 
                    error: 'Failed to upload profile picture',
                    details: error.message 
                  })
                }
                reject(error)
                return
              }
              
              profilePic = result.secure_url
              
              try {
                user.name = name || user.name
                user.username = username || user.username 
                user.email = email || user.email 
                user.profilePic = profilePic || user.profilePic 
                user.bio = bio || user.bio
                user.country = country !== undefined ? country : user.country

                user = await user.save()

                // Return safe fields only (exclude password)
                if (!res.headersSent) {
                  res.status(200).json({
                    _id: user._id,
                    name: user.name,
                    username: user.username,
                    email: user.email,
                    bio: user.bio,
                    profilePic: user.profilePic,
                    country: user.country
                  })
                }
                resolve()
              } catch (error) {
                console.error('Error updating user after upload:', error)
                if (!res.headersSent) {
                  res.status(500).json({ 
                    error: error.message || 'Failed to update profile' 
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

      // No file upload - update user immediately
      user.name = name || user.name
      user.username = username || user.username 
      user.email = email || user.email 
      user.profilePic = profilePic || user.profilePic 
      user.bio = bio || user.bio
      user.country = country !== undefined ? country : user.country

      user = await user.save()

      // Return safe fields only (exclude password)
      res.status(200).json({
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        bio: user.bio,
        profilePic: user.profilePic,
        country: user.country
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
        const { search, q } = req.query  // Support both 'search' and 'q' params
        const query = search || q

        if (!query || query.trim() === "") {
            return res.status(200).json([])  // Return empty array if no search term
        }

        // Enhanced search: matches username OR name (case-insensitive, partial match)
        const searchRegex = new RegExp(query.trim(), 'i')
        const users = await User.find({
            $or: [
                { username: searchRegex },
                { name: searchRegex }
            ]
        })
        .select('username name profilePic bio')  // Include bio for better results
        .limit(20)  // Increased limit for contributor search

        res.status(200).json(users)
    }
    catch(error) {
        console.log(error)
        res.status(500).json(error)
    }
}

// SMART SUGGESTED USERS ALGORITHM
// 1. Fetch 7 users from same country (randomized)
// 2. For each followed user, suggest 1 random user from their followers
// 3. Combine and randomize, return up to 7-10 users
export const getSuggestedUsers = async(req, res) => {
    try {
        const userId = req.user._id
        const currentUser = await User.findById(userId).select('country following')
        
        if (!currentUser) {
            return res.status(400).json({ error: "User not found" })
        }
        
        // Ensure following is an array
        if (!currentUser.following) {
            currentUser.following = []
        }

        const suggestedUsers = []
        const maxSuggestions = 5 // Maximum suggestions to return (optimized)
        // Convert to ObjectIds for MongoDB query - build exclude list once
        const excludeIds = [new mongoose.Types.ObjectId(userId)] // Exclude current user
        const followingIdsStrings = new Set() // For fast lookup
        
        // Exclude Football system account from suggestions
        const footballAccount = await User.findOne({ username: 'Football' }).select('_id')
        if (footballAccount) {
            excludeIds.push(new mongoose.Types.ObjectId(footballAccount._id))
        }
        
        if (currentUser.following && currentUser.following.length > 0) {
            currentUser.following.forEach(id => {
                try {
                    const objectId = id instanceof mongoose.Types.ObjectId 
                        ? id 
                        : new mongoose.Types.ObjectId(id.toString())
                    excludeIds.push(objectId)
                    followingIdsStrings.add(id.toString()) // Store string for fast filtering
                } catch (error) {
                    // Silently skip invalid IDs in production
                }
            })
        }

        // STEP 1: Get users from same country (if country is set) - PRIORITY
        if (currentUser.country && currentUser.country.trim() !== "") {
            const userCountry = currentUser.country.trim()
            
            // Optimized query - MongoDB handles exclusion efficiently
            const countryUsers = await User.find({
                $and: [
                    { country: { $exists: true, $ne: null, $ne: "" } },
                    { country: { $regex: new RegExp(`^${userCountry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                    { _id: { $nin: excludeIds } }
                ]
            })
            .select('username name profilePic country followers')
            .limit(maxSuggestions * 2) // Get more to randomize from
            
            // Fast filter using Set lookup (O(1) instead of O(n))
            const filteredCountryUsers = countryUsers.filter(user => {
                return !followingIdsStrings.has(user._id.toString())
            })
            
            // Randomize and take up to maxSuggestions (5)
            const shuffled = filteredCountryUsers.sort(() => 0.5 - Math.random())
            const countrySuggestions = shuffled.slice(0, maxSuggestions)
            suggestedUsers.push(...countrySuggestions)
            
            // Add to exclude list for next steps
            countrySuggestions.forEach(user => {
                excludeIds.push(new mongoose.Types.ObjectId(user._id))
            })
        }

        // STEP 2: If not enough from same country, get random users from OTHER countries
        if (suggestedUsers.length < maxSuggestions) {
            const needed = maxSuggestions - suggestedUsers.length
            
            // Get random users from ANY country (excluding same country if we already have some)
            const randomUsers = await User.find({
                _id: { $nin: excludeIds },
                // If we have some from same country, exclude same country for variety
                ...(suggestedUsers.length > 0 && currentUser.country && currentUser.country.trim() !== ""
                    ? { country: { $ne: currentUser.country } }
                    : {})
            })
            .select('username name profilePic country followers')
            .limit(needed * 3) // Get more to randomize from
            
            const filteredRandomUsers = randomUsers.filter(user => {
                return !followingIdsStrings.has(user._id.toString())
            })
            
            const shuffled = filteredRandomUsers.sort(() => 0.5 - Math.random())
            suggestedUsers.push(...shuffled.slice(0, needed))
        }
        
        // Fallback: If still no suggestions (should rarely happen)
        if (suggestedUsers.length === 0) {
            const fallbackUsers = await User.find({
                _id: { $nin: excludeIds }
            })
            .select('username name profilePic country followers')
            .limit(maxSuggestions)
            
            const filteredFallback = fallbackUsers.filter(user => {
                return !followingIdsStrings.has(user._id.toString())
            })
            
            suggestedUsers.push(...filteredFallback.slice(0, maxSuggestions))
        }

        // FINAL SAFETY FILTER: Single pass filter using Set (O(n) instead of O(n*m))
        const userIdStr = userId.toString()
        const finalSuggestions = suggestedUsers
            .filter(user => {
                const userStr = user._id.toString()
                return userStr !== userIdStr && !followingIdsStrings.has(userStr)
            })
            .sort(() => 0.5 - Math.random())
            .slice(0, maxSuggestions)
        
        res.status(200).json(finalSuggestions)
    }
    catch(error) {
        console.error('Error in getSuggestedUsers:', error)
        res.status(500).json({ error: error.message || "Failed to get suggested users" })
    }
}







