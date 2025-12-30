import User from '../models/user.js'
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
        
        console.log(`👤 Current user: ${currentUser._id}, following: ${currentUser.following.length} users`)
        if (currentUser.following.length > 0) {
            console.log(`   Following IDs:`, currentUser.following.map(id => id.toString()))
        }

        const suggestedUsers = []
        // Convert to ObjectIds for MongoDB query
        const excludeIds = [new mongoose.Types.ObjectId(userId)] // Exclude current user
        if (currentUser.following && currentUser.following.length > 0) {
            currentUser.following.forEach(id => {
                try {
                    // Handle both string and ObjectId formats
                    const objectId = id instanceof mongoose.Types.ObjectId 
                        ? id 
                        : new mongoose.Types.ObjectId(id.toString())
                    excludeIds.push(objectId)
                } catch (error) {
                    console.error(`⚠️ Error converting ID to ObjectId: ${id}`, error)
                }
            })
        }
        
        console.log(`🚫 Total exclude IDs: ${excludeIds.length}`, excludeIds.map(id => id.toString()))

        // STEP 1: Get 7 users from same country (if country is set)
        if (currentUser.country && currentUser.country.trim() !== "") {
            const userCountry = currentUser.country.trim()
            console.log(`🔍 Searching for users from country: "${userCountry}"`)
            console.log(`🚫 Excluding ${excludeIds.length} users (current user + following)`)
            
            // Case-insensitive search for country - also check for empty/null countries
            // Use both ObjectId and string comparison to handle any ID format issues
            const countryUsers = await User.find({
                $and: [
                    { country: { $exists: true, $ne: null, $ne: "" } }, // Country exists and is not empty
                    { country: { $regex: new RegExp(`^${userCountry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }, // Case-insensitive exact match (escaped for regex)
                    { _id: { $nin: excludeIds } } // Not current user or already followed (using ObjectIds)
                ]
            })
            .select('username name profilePic country followers')
            .limit(20) // Get more to randomize from
            
            // Additional safety filter: Remove any users that are in the following list (handles edge cases)
            const followingIdsStrings = currentUser.following.map(id => id.toString())
            const filteredCountryUsers = countryUsers.filter(user => {
                const userIdStr = user._id.toString()
                return !followingIdsStrings.includes(userIdStr)
            })
            
            if (filteredCountryUsers.length !== countryUsers.length) {
                console.log(`⚠️ Filtered out ${countryUsers.length - filteredCountryUsers.length} followed users that slipped through query`)
            }
            
            console.log(`📍 Found ${countryUsers.length} total users from country "${userCountry}"`)
            
            // Debug: Show all users with their countries (for troubleshooting)
            if (countryUsers.length === 0) {
                console.log(`⚠️ No users found! Checking database...`)
                // Check if there are ANY users with this country (without exclusions)
                const allCountryUsers = await User.find({
                    country: { $regex: new RegExp(`^${userCountry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
                }).select('username country _id').limit(10)
                console.log(`🔍 All users with country "${userCountry}":`, allCountryUsers.map(u => ({ 
                    username: u.username, 
                    country: u.country || 'NOT SET',
                    _id: u._id.toString()
                })))
                
                // Show what we're excluding
                console.log(`🚫 Excluding IDs:`, excludeIds.map(id => id.toString()))
                
                // Show sample users in database
                const allUsers = await User.find({}).select('username country _id').limit(10)
                console.log(`🔍 Sample users in database:`, allUsers.map(u => ({ 
                    username: u.username, 
                    country: u.country || 'NOT SET',
                    _id: u._id.toString()
                })))
            } else {
                console.log(`✅ Found users:`, countryUsers.map(u => u.username))
            }
            
            // Randomize and take 7 (use filtered list)
            const shuffled = filteredCountryUsers.sort(() => 0.5 - Math.random())
            const countrySuggestions = shuffled.slice(0, 7)
            suggestedUsers.push(...countrySuggestions)
            
            // Add to exclude list (convert to ObjectId)
            countrySuggestions.forEach(user => {
                excludeIds.push(new mongoose.Types.ObjectId(user._id))
            })
            
            console.log(`✅ Added ${countrySuggestions.length} users from country: ${userCountry}`)
            if (countrySuggestions.length > 0) {
                console.log(`   Users: ${countrySuggestions.map(u => u.username).join(', ')}`)
            }
        } else {
            console.log('⚠️ User has no country set, skipping country-based suggestions')
        }

        // STEP 2: For each followed user, get 1 random user from their followers
        if (currentUser.following && currentUser.following.length > 0) {
            const followedUsers = await User.find({
                _id: { $in: currentUser.following }
            })
            .select('followers')
            
            const followingIdsStrings = currentUser.following.map(id => id.toString())
            
            for (const followedUser of followedUsers) {
                if (followedUser.followers && followedUser.followers.length > 0) {
                    // Filter out users we already have or are following (convert to ObjectIds for comparison)
                    const excludeIdsStrings = excludeIds.map(id => id.toString())
                    const availableFollowers = followedUser.followers.filter(followerId => {
                        const followerIdStr = followerId.toString()
                        // Exclude if already in suggestions, already following, or is current user
                        return !excludeIdsStrings.includes(followerIdStr) && 
                               !followingIdsStrings.includes(followerIdStr) &&
                               followerIdStr !== userId.toString()
                    })
                    
                    if (availableFollowers.length > 0) {
                        // Pick 1 random follower
                        const randomFollowerId = availableFollowers[
                            Math.floor(Math.random() * availableFollowers.length)
                        ]
                        
                        const followerUser = await User.findById(randomFollowerId)
                            .select('username name profilePic country followers')
                        
                        if (followerUser) {
                            // Double-check: ensure not in following list
                            const followerUserIdStr = followerUser._id.toString()
                            if (!followingIdsStrings.includes(followerUserIdStr)) {
                                suggestedUsers.push(followerUser)
                                excludeIds.push(new mongoose.Types.ObjectId(followerUser._id))
                                console.log(`👥 Suggested 1 user from ${followedUser._id}'s followers`)
                            }
                        }
                    }
                }
            }
        }

        // STEP 3: If we still need more users, fill with random users
        const maxSuggestions = 10
        if (suggestedUsers.length < maxSuggestions) {
            const needed = maxSuggestions - suggestedUsers.length
            const randomUsers = await User.find({
                _id: { $nin: excludeIds }, // Using ObjectIds array
                ...(currentUser.country && currentUser.country.trim() !== "" 
                    ? { country: { $ne: currentUser.country } } 
                    : {})
            })
            .select('username name profilePic country followers')
            .limit(20)
            
            // Randomize and take what we need
            const shuffled = randomUsers.sort(() => 0.5 - Math.random())
            const additional = shuffled.slice(0, needed)
            suggestedUsers.push(...additional)
            console.log(`🎲 Added ${additional.length} random users to fill suggestions`)
        }
        
        // If still no suggestions (new user, no country, no follows), get any random users
        if (suggestedUsers.length === 0) {
            console.log('⚠️ No suggestions found, fetching random users as fallback')
            const fallbackUsers = await User.find({
                _id: { $ne: userId }
            })
            .select('username name profilePic country followers')
            .limit(10)
            
            const shuffled = fallbackUsers.sort(() => 0.5 - Math.random())
            suggestedUsers.push(...shuffled.slice(0, 7))
        }

        // Final shuffle to randomize order
        const finalSuggestions = suggestedUsers
            .sort(() => 0.5 - Math.random())
            .slice(0, maxSuggestions)

        console.log(`✅ Returning ${finalSuggestions.length} suggested users`)
        console.log(`   Current user country: "${currentUser.country || 'NOT SET'}"`)
        console.log(`   Current user following: ${currentUser.following?.length || 0} users`)
        
        res.status(200).json(finalSuggestions)
    }
    catch(error) {
        console.error('Error in getSuggestedUsers:', error)
        res.status(500).json({ error: error.message || "Failed to get suggested users" })
    }
}







