import Activity from '../models/activity.js'
import { getIO, getAllUserSockets } from '../socket/socket.js'
import User from '../models/user.js'

// Create an activity and emit to followers
export const createActivity = async (userId, type, options = {}) => {
    try {
        const activity = new Activity({
            userId: userId,
            type: type,
            targetUser: options.targetUser || null,
            postId: options.postId || null,
            metadata: options.metadata || {}
        })

        await activity.save()
        
        // Populate user info
        await activity.populate('userId', 'username name profilePic')
        if (activity.targetUser) {
            await activity.populate('targetUser', 'username name profilePic')
        }
        if (activity.postId) {
            await activity.populate({
                path: 'postId',
                select: 'text img postedBy',
                populate: {
                    path: 'postedBy',
                    select: 'username name profilePic'
                }
            })
        }

        // Emit to user's followers (for activity feed)
        const io = getIO()
        if (io) {
            const user = await User.findById(userId).select('followers')
            if (user && user.followers && user.followers.length > 0) {
                const socketMap = await getAllUserSockets()
                
                user.followers.forEach(followerId => {
                    const followerIdStr = followerId.toString()
                    const socketData = socketMap[followerIdStr]
                    if (socketData && socketData.socketId) {
                        io.to(socketData.socketId).emit('newActivity', activity)
                    }
                })
            }
        }

        return activity
    } catch (error) {
        console.error('Error creating activity:', error)
        return null
    }
}

// Get activities for a user (their friends' activities)
export const getActivities = async (req, res) => {
    try {
        const userId = req.user._id
        const limit = parseInt(req.query.limit) || 20

        // Get user's following list
        const user = await User.findById(userId).select('following')
        const followingIds = user?.following?.map(f => f.toString()) || []

        // Get activities from users they follow
        const activities = await Activity.find({
            userId: { $in: followingIds }
        })
        .populate('userId', 'username name profilePic')
        .populate('targetUser', 'username name profilePic')
        .populate({
            path: 'postId',
            select: 'text img postedBy',
            populate: {
                path: 'postedBy',
                select: 'username name profilePic'
            }
        })
        .sort({ createdAt: -1 })
        .limit(limit)

        res.status(200).json({ activities })
    } catch (error) {
        console.error('Error fetching activities:', error)
        res.status(500).json({ error: error.message })
    }
}


