import User from '../models/user.js'
import Post from '../models/post.js'
import Follow from '../models/follow.js'
import bcryptjs from 'bcryptjs' 
import GenerateToken from '../utils/GenerateToken.js'
import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'
import { LIVE_CHANNELS } from '../config/channels.js'
import * as redisService from '../services/redis.js'





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

    
         // Read-from-Follow (scalable): determine follow state from Follow collection
         const followExists = await Follow.findOne({
            followerId: req.user._id,
            followeeId: id
         }).select('_id').lean()
         const isFollowing = !!followExists

         if(isFollowing){
             
           await User.findByIdAndUpdate(req.user._id,{$pull:{following:id}})
           await User.findByIdAndUpdate(id,{$pull:{followers:req.user._id}})
          // Dual-write: remove from follows collection (ignore errors to stay non-breaking)
          try {
            await Follow.deleteOne({ followerId: req.user._id, followeeId: id })
          } catch (e) {
            console.error('⚠️ [FollowAndUnfollow] Failed to delete follow doc:', e.message)
          }
          
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
                   
                   // Get ALL Football posts (including "no matches" posts)
                   const footballPosts = await Post.find({
                       postedBy: id
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
           // Dual-write: add to follows collection (ignore errors to stay non-breaking)
           try {
             await Follow.create({ followerId: req.user._id, followeeId: id })
           } catch (e) {
             if (e?.code === 11000) {
               // duplicate follow, safe to ignore
             } else {
               console.error('⚠️ [FollowAndUnfollow] Failed to create follow doc:', e.message)
             }
           }
           
            // REMOVED: Don't update Football post's updatedAt when following
            // This was causing Football posts to jump to top for ALL users who follow Football
            // when ANY user follows Football, which is incorrect behavior
            // The feed will show Football posts naturally based on their original createdAt/updatedAt
            if (userToModify.username === 'Football') {
                try {
                    
                    // Automatically fetch matches if database is empty (run in background, don't wait)
                    // This ensures users see matches immediately after following
                    const Match = (await import('../models/football.js')).Match
                    const matchCount = await Match.countDocuments({})
                    
                    if (matchCount === 0) {
                        console.log(`⚽ [FollowAndUnfollow] Database is empty, automatically fetching matches for user ${req.user.username}...`)
                        // Run in background - don't wait for it to complete
                        // Create a simple wrapper that calls the fetch logic directly
                        setImmediate(async () => {
                            try {
                                const { manualFetchFixtures } = await import('./football.js')
                                // Create minimal req/res objects
                                const mockReq = { method: 'POST', url: '/api/football/fetch/manual' }
                                const mockRes = {
                                    status: (code) => ({
                                        json: (data) => {
                                            if (code === 200) {
                                                console.log(`✅ [FollowAndUnfollow] Auto-fetched ${data.totalFetched} matches`)
                                            } else {
                                                console.error(`❌ [FollowAndUnfollow] Auto-fetch failed:`, data)
                                            }
                                        }
                                    }),
                                    json: (data) => {
                                        if (data.error) {
                                            console.error(`❌ [FollowAndUnfollow] Auto-fetch error:`, data.error)
                                        } else if (data.totalFetched !== undefined) {
                                            console.log(`✅ [FollowAndUnfollow] Auto-fetched ${data.totalFetched} matches`)
                                        }
                                    }
                                }
                                await manualFetchFixtures(mockReq, mockRes)
                            } catch (err) {
                                console.error('❌ [FollowAndUnfollow] Error auto-fetching matches:', err)
                            }
                        })
                    } else {
                        console.log(`⚽ [FollowAndUnfollow] Database already has ${matchCount} matches, skipping auto-fetch`)
                    }
                } catch (error) {
                    console.error('❌ [FollowAndUnfollow] Error auto-fetching matches:', error)
                }
            }
           
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
 
        const{name,email,password,bio,username,country,instagram}= req.body
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
                user.instagram = instagram !== undefined ? instagram : user.instagram

                user = await user.save()

                // Update all existing comments with new profile picture and username
                // This ensures all comments show the updated profile picture immediately
                try {
                  await Post.updateMany(
                    { "replies.userId": userId },
                    {
                      $set: {
                        "replies.$[reply].username": user.username,
                        "replies.$[reply].userProfilePic": user.profilePic,
                      },
                    },
                    { arrayFilters: [{ "reply.userId": userId }] }
                  )
                  console.log(`✅ Updated all comments for user ${user.username} with new profile picture`)
                } catch (updateError) {
                  // Log error but don't fail the profile update
                  console.error('Error updating comments with new profile picture:', updateError)
                }

                // Return safe fields only (exclude password)
                // Include followers and following to preserve them in frontend
                if (!res.headersSent) {
                  res.status(200).json({
                    _id: user._id,
                    name: user.name,
                    username: user.username,
                    email: user.email,
                    bio: user.bio,
                    profilePic: user.profilePic,
                    country: user.country,
                    instagram: user.instagram,
                    followers: user.followers || [],
                    following: user.following || []
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
      user.instagram = instagram !== undefined ? instagram : user.instagram

      user = await user.save()

      // Update all existing comments with new profile picture and username
      // This ensures all comments show the updated profile picture immediately
      // Only update if profile picture or username actually changed
      const profilePicChanged = profilePic && profilePic !== user.profilePic
      const usernameChanged = username && username !== user.username
      
      if (profilePicChanged || usernameChanged) {
        try {
          await Post.updateMany(
            { "replies.userId": userId },
            {
              $set: {
                "replies.$[reply].username": user.username,
                "replies.$[reply].userProfilePic": user.profilePic,
              },
            },
            { arrayFilters: [{ "reply.userId": userId }] }
          )
          console.log(`✅ Updated all comments for user ${user.username} with new profile picture/username`)
        } catch (updateError) {
          // Log error but don't fail the profile update
          console.error('Error updating comments with new profile picture:', updateError)
        }
      }

      // Return safe fields only (exclude password)
      // Include followers and following to preserve them in frontend
      res.status(200).json({
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        bio: user.bio,
        profilePic: user.profilePic,
        country: user.country,
        instagram: user.instagram,
        followers: user.followers || [],
        following: user.following || []
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

        // Debug logging
        if (import.meta.env?.DEV || process.env.NODE_ENV !== 'production') {
            console.log(`[getUserProfile] Request received for query: ${query}`)
        }

        // Validate query parameter
        if (!query || query.trim() === '') {
            return res.status(400).json({error:"Invalid user identifier"})
        }

        // Trim the query to remove any whitespace
        const trimmedQuery = query.trim()

        let user 

        if(mongoose.Types.ObjectId.isValid(trimmedQuery)){
         user = await User.findOne({_id:trimmedQuery}).select('-password')

        }else{
          user = await User.findOne({username:trimmedQuery}).select('-password')
        }

      if(!user){
        // Return 404 for not found
        if (import.meta.env?.DEV || process.env.NODE_ENV !== 'production') {
            console.log(`[getUserProfile] User not found for query: ${trimmedQuery}`)
        }
        return res.status(404).json({error:"User not found"})
      }

      // Read-from-Follow (scalable) with backwards-compatible payload:
      // - keep `followers`/`following` arrays for current app (but cap them)
      // - add counts + `isFollowedByMe` for correctness when arrays are capped
      const LIMIT_LIST = 5000
      const viewerId = req.user?._id

      const [followersCount, followingCount] = await Promise.all([
        Follow.countDocuments({ followeeId: user._id }),
        Follow.countDocuments({ followerId: user._id }),
      ])

      let isFollowedByMe = false
      if (viewerId) {
        const exists = await Follow.findOne({ followerId: viewerId, followeeId: user._id })
          .select('_id')
          .lean()
        isFollowedByMe = !!exists
      }

      const [followersDocs, followingDocs] = await Promise.all([
        Follow.find({ followeeId: user._id }).select('followerId').limit(LIMIT_LIST).lean(),
        Follow.find({ followerId: user._id }).select('followeeId').limit(LIMIT_LIST).lean(),
      ])

      const followers = followersDocs.map((d) => d.followerId?.toString?.() ?? String(d.followerId))
      const following = followingDocs.map((d) => d.followeeId?.toString?.() ?? String(d.followeeId))

      // Merge onto the user object (strip mongoose internals by using toObject)
      const userObj = user.toObject ? user.toObject() : user
      res.status(200).json({
        ...userObj,
        followers,
        following,
        followersCount,
        followingCount,
        isFollowedByMe,
      })

    }
    catch(error){
      console.error('Error in getUserProfile:', error)
        res.status(500).json({error: error.message || "Internal server error"})
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

        // List of system accounts/channels to exclude from search
        const systemAccounts = [
            'Football', 'Weather', 'AlJazeera', 'NBCNews', 'BeinSportsNews', 
            'SkyNews', 'Cartoonito', 'NatGeoKids', 'SciShowKids', 'JJAnimalTime',
            'KidsArabic', 'NatGeoAnimals', 'MBCDrama', 'Fox11'
        ]

        // Enhanced search: matches username OR name (case-insensitive, partial match)
        const searchRegex = new RegExp(query.trim(), 'i')
        const users = await User.find({
            $or: [
                { username: searchRegex },
                { name: searchRegex }
            ],
            // Exclude system accounts/channels
            username: { $nin: systemAccounts }
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
        const currentUser = await User.findById(userId).select('country')
        
        if (!currentUser) {
            return res.status(400).json({ error: "User not found" })
        }

        const suggestedUsers = []
        const maxSuggestions = 5 // Maximum suggestions to return (optimized)
        // Convert to ObjectIds for MongoDB query - build exclude list once
        const excludeIds = [new mongoose.Types.ObjectId(userId)] // Exclude current user
        const followingIdsStrings = new Set() // For fast lookup
        
        // Exclude Football system account and ALL channel accounts from suggestions
        // Get all channel usernames from config + Football system account + any additional channels
        const channelUsernames = [
            'Football', // System account (not in LIVE_CHANNELS)
            'Weather', // Weather system account
            ...LIVE_CHANNELS.map(channel => channel.username), // All channel accounts from config
            'SkySportsNews' // Additional channel (if exists in database but not in config)
        ]
        
        // Find all channel accounts and exclude them
        const channelAccounts = await User.find({ 
            username: { $in: channelUsernames } 
        }).select('_id')
        
        channelAccounts.forEach(account => {
            excludeIds.push(new mongoose.Types.ObjectId(account._id))
        })
        
        // Read-from-Follow: exclude already-followed users (cap for safety)
        const followingDocs = await Follow.find({ followerId: userId }).select('followeeId').limit(5000).lean()
        if (followingDocs && followingDocs.length > 0) {
            followingDocs.forEach(d => {
                const idStr = d.followeeId?.toString?.() ?? String(d.followeeId)
                try {
                    const objectId = new mongoose.Types.ObjectId(idStr)
                    excludeIds.push(objectId)
                    followingIdsStrings.add(idStr)
                } catch (error) {
                    // ignore invalid ids
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

// Get all users who are currently in active chess games
export const getBusyChessUsers = async (req, res) => {
    try {
        redisService.ensureRedis()
        const client = redisService.getRedis()
        const busyUserIds = []
        let cursor = '0'
        let scanCount = 0
        const maxIterations = 100
        
        do {
            scanCount++
            if (scanCount > maxIterations) {
                console.error('❌ [getBusyChessUsers] Max iterations reached, breaking loop')
                break
            }
            
            const result = await client.scan(cursor, {
                MATCH: 'activeChessGame:*',
                COUNT: 100
            })
            
            // Handle both array [cursor, keys] and object {cursor, keys} formats
            let nextCursor, keys
            if (Array.isArray(result)) {
                nextCursor = result[0]
                keys = result[1] || []
            } else if (result && typeof result === 'object') {
                nextCursor = result.cursor
                keys = result.keys || []
            } else {
                break
            }
            
            cursor = nextCursor.toString()
            
            // Extract user IDs from keys (format: activeChessGame:userId)
            keys.forEach(key => {
                const userId = key.replace('activeChessGame:', '')
                if (userId) {
                    busyUserIds.push(userId)
                }
            })
        } while (cursor !== '0')
        
        res.status(200).json({ busyUserIds })
    } catch (error) {
        console.error('Error in getBusyChessUsers:', error)
        res.status(500).json({ error: error.message || "Failed to get busy chess users" })
    }
}

// Get users that current user is following
export const getFollowingUsers = async (req, res) => {
    try {
        const userId = req.user._id
        // Read-from-Follow: get followee IDs (limit to 30 for performance)
        const followingDocs = await Follow.find({ followerId: userId })
            .select('followeeId')
            .sort({ createdAt: -1 })
            .limit(30)
            .lean()

        if (!followingDocs || followingDocs.length === 0) {
            return res.status(200).json([])
        }

        const followeeIds = followingDocs.map(d => d.followeeId)

        const followingUsers = await User.find({
            _id: { $in: followeeIds }
        }).select('username name profilePic bio').limit(30).sort({ username: 1 })
        
        res.status(200).json(followingUsers)
    } catch (error) {
        console.error('Error getting following users:', error)
        res.status(500).json({ error: error.message || "Failed to get following users" })
    }
}







